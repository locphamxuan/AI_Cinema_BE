import { ServiceUnavailableException } from '@nestjs/common';
import { SupportAudience, SupportSenderType } from '@prisma/client';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import type { SupportAgentService } from '../ai/support-agent.service';
import type { RetrievalService } from '../knowledge/retrieval.service';
import { AiPlaygroundService } from './ai-playground.service';

const CHUNK = {
  articleId: 'a1',
  title: 'Hủy gói Tháng',
  heading: 'Mốc 24 giờ',
  chunkIndex: 0,
  score: 0.82,
  content: 'x'.repeat(400),
};

function build() {
  const retrieval = { retrieve: jest.fn().mockResolvedValue([CHUNK]) };
  const agent = {
    reply: jest.fn().mockResolvedValue({
      reply: 'Bạn hủy trong 24 giờ đầu sẽ được hoàn tiền.',
      resolution: 'ANSWERED',
      confidence: 0.9,
      quickReplies: [],
      metadata: {
        model: 'mock',
        latencyMs: 12,
        sources: [{ articleId: 'a1', title: 'Hủy gói Tháng', heading: 'Mốc 24 giờ' }],
        toolCalls: [{ name: 'get_plan_catalog', arguments: {}, result: { ok: true } }],
      },
    }),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      coinRateVnd: 1000,
      bonusCoinExpiryDays: 30,
      subscriptionCancelWindowHours: 24,
      refundOnRemoval: true,
    }),
  };
  const service = new AiPlaygroundService(
    retrieval as unknown as RetrievalService,
    agent as unknown as SupportAgentService,
    settings as unknown as PlatformSettingService,
  );
  return { service, retrieval, agent };
}

describe('AiPlaygroundService.previewChat', () => {
  it('runs the member agent on the question and returns the answer with its sources, saving nothing', async () => {
    const { service, retrieval, agent } = build();

    const result = await service.previewChat('admin-1', {
      question: 'Hủy gói có được hoàn tiền không?',
      history: [
        { role: 'MEMBER', content: 'Chào' },
        { role: 'AI', content: 'Chào bạn' },
      ],
    });

    expect(retrieval.retrieve).toHaveBeenCalledWith('Chào\nChào bạn\nHủy gói có được hoàn tiền không?', {
      audience: undefined,
      locale: undefined,
    });
    expect(agent.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'admin-1',
        audience: 'MEMBER',
        history: [
          { senderType: SupportSenderType.MEMBER, content: 'Chào' },
          { senderType: SupportSenderType.AI_CHATBOT, content: 'Chào bạn' },
        ],
        platformFacts: expect.objectContaining({ subscriptionCancelWindowHours: 24 }),
      }),
    );
    expect(result).toMatchObject({
      answer: 'Bạn hủy trong 24 giờ đầu sẽ được hoàn tiền.',
      resolution: 'ANSWERED',
      grounded: true,
      sources: [{ articleId: 'a1' }],
      toolsUsed: ['get_plan_catalog'],
      escalationReason: null,
    });
    expect(result.retrieved[0].excerpt).toHaveLength(301);
  });

  it('answers as the Staff assistant when asked for the Staff audience', async () => {
    const { service, agent } = build();
    await service.previewChat('admin-1', { question: 'Quy trình hoàn Coin?', audience: SupportAudience.STAFF });
    expect(agent.reply).toHaveBeenCalledWith(expect.objectContaining({ audience: 'STAFF' }));
  });

  it('turns an unavailable AI into 503', async () => {
    const { service, agent } = build();
    agent.reply.mockRejectedValue(new SupportAiUnavailableError('DISABLED', 'off'));
    await expect(service.previewChat('admin-1', { question: 'Xin chào' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
