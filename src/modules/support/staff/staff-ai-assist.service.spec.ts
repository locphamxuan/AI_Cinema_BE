import { NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { SupportAudience, SupportSenderType } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import type { SupportAgentService } from '../ai/support-agent.service';
import type { SupportMessageService } from '../chat/support-message.service';
import type { RetrievalService } from '../knowledge/retrieval.service';
import { StaffAiAssistService } from './staff-ai-assist.service';

describe('StaffAiAssistService', () => {
  const prisma = { supportConversation: { findUnique: jest.fn() } };
  const messages = { recentForAi: jest.fn() };
  const retrieval = { retrieve: jest.fn() };
  const agent = { reply: jest.fn() };
  const settings = { get: jest.fn() };
  const service = new StaffAiAssistService(
    { support: { aiHistoryMessages: 20 } } as unknown as AppConfig,
    prisma as unknown as PrismaService,
    messages as unknown as SupportMessageService,
    retrieval as unknown as RetrievalService,
    agent as unknown as SupportAgentService,
    settings as unknown as PlatformSettingService,
  );
  const ARTICLE = { articleId: 'a1', title: 'Coin', chunkIndex: 0, heading: 'Số dư', content: '...', score: 0.9 };
  const reply = (toolResult: unknown = { ok: true }) => ({
    reply: 'Ví thành viên còn 100 Coin chính; giao dịch hôm qua là mở khoá tập 3.',
    resolution: 'ANSWERED',
    confidence: 0.8,
    quickReplies: [],
    metadata: {
      model: 'm',
      sources: [{ articleId: 'a1', title: 'Coin', heading: 'Số dư' }],
      toolCalls: [{ name: 'get_member_wallet', arguments: {}, result: toolResult }],
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.supportConversation.findUnique.mockResolvedValue({ id: 'c1', memberId: 'member-1' });
    messages.recentForAi.mockResolvedValue([
      { senderType: SupportSenderType.MEMBER, content: 'Sao tôi bị trừ Coin?' },
      { senderType: SupportSenderType.AI_CHATBOT, content: 'Mình chuyển nhân viên.' },
    ]);
    retrieval.retrieve.mockResolvedValue([ARTICLE]);
    settings.get.mockResolvedValue({
      coinRateVnd: 1000,
      bonusCoinExpiryDays: 30,
      subscriptionCancelWindowHours: 24,
      refundOnRemoval: true,
    });
    agent.reply.mockResolvedValue(reply());
  });

  it("drafts a reply to the member's last message, scoped to the case member, with Staff articles", async () => {
    const res = await service.suggest('c1');
    expect(retrieval.retrieve).toHaveBeenCalledWith(expect.any(String), { audience: SupportAudience.STAFF });
    expect(agent.reply).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1', message: 'Sao tôi bị trừ Coin?', audience: 'STAFF' }),
    );
    expect(res).toMatchObject({ conversationId: 'c1', grounded: true, toolsUsed: ['get_member_wallet'] });
  });

  it("answers the Staff member's own question when given", async () => {
    await service.suggest('c1', '  Kiểm tra gói của thành viên  ');
    expect(agent.reply).toHaveBeenCalledWith(expect.objectContaining({ message: 'Kiểm tra gói của thành viên' }));
  });

  it('marks a draft with neither an article nor tool data as ungrounded', async () => {
    retrieval.retrieve.mockResolvedValue([]);
    agent.reply.mockResolvedValue(reply({ ok: false, error: 'NOT_FOUND' }));
    await expect(service.suggest('c1')).resolves.toMatchObject({ grounded: false });
  });

  it('404s an unknown case and 422s a case with nothing to answer', async () => {
    prisma.supportConversation.findUnique.mockResolvedValueOnce(null);
    await expect(service.suggest('c9')).rejects.toBeInstanceOf(NotFoundException);
    messages.recentForAi.mockResolvedValue([]);
    await expect(service.suggest('c1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('turns an unavailable AI provider into a 503', async () => {
    agent.reply.mockRejectedValue(new SupportAiUnavailableError('DISABLED', 'off'));
    await expect(service.suggest('c1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
