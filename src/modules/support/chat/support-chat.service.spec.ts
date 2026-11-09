import { SupportSenderType, SupportStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { SupportAgentService } from '../ai/support-agent.service';
import { PromptBuilderService } from '../ai/prompt-builder';
import { SummaryService } from '../ai/summary.service';
import type { RetrievalService } from '../knowledge/retrieval.service';
import type { SupportRecipientsService } from '../staff/support-recipients.service';
import type { EscalationService } from './escalation.service';
import type { ResolutionService } from './resolution.service';
import { SupportChatService } from './support-chat.service';
import type { SupportConversationService } from './support-conversation.service';
import type { SupportMessageService } from './support-message.service';
import type { SupportTurnLockService } from './support-turn-lock.service';

const now = new Date('2026-11-09T00:00:00.000Z');

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    memberId: 'member-1',
    status: SupportStatus.AI_HANDLING,
    priority: 'NORMAL',
    escalationReason: null,
    aiSummary: null,
    lastMessageAt: now,
    lastMemberMessageAt: now,
    lastStaffMessageAt: null,
    escalatedAt: null,
    claimedAt: null,
    resolvedAt: null,
    closedAt: null,
    closeReason: null,
    aiResolutionSuggestedAt: null,
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    senderType: SupportSenderType.MEMBER,
    senderId: 'member-1',
    content: 'Nội dung',
    isInternal: false,
    clientMessageId: null,
    replyToMessageId: null,
    aiMetadata: null,
    createdAt: now,
    ...overrides,
  };
}

function buildService(replyText: string) {
  const config = {
    support: {
      aiHistoryMessages: 20,
      ragTopK: 6,
      ragMinScore: 0.35,
      dailyMessageLimit: 200,
      messageMaxChars: 4000,
    },
  } as unknown as AppConfig;

  const memberMessage = message({ id: 'member-message', content: 'OTP của tôi là 123456' });
  const aiMessage = message({
    id: 'ai-message',
    senderType: SupportSenderType.AI_CHATBOT,
    senderId: null,
    replyToMessageId: memberMessage.id,
  });

  const conversations = {
    findOwned: jest.fn().mockResolvedValue(conversation()),
    findById: jest.fn().mockResolvedValue(conversation()),
    touchMessages: jest.fn().mockResolvedValue(undefined),
    recordAiTurn: jest.fn().mockResolvedValue(undefined),
  };
  const create = jest
    .fn<Promise<unknown>, [{ content: string }]>()
    .mockResolvedValueOnce(memberMessage)
    .mockResolvedValueOnce(aiMessage);
  const messages = {
    findByClientMessageId: jest.fn(),
    create,
    countMemberMessagesSince: jest.fn().mockResolvedValue(0),
    recentForAi: jest.fn().mockResolvedValue([memberMessage]),
  };
  const agent = {
    reply: jest.fn().mockResolvedValue({
      reply: replyText,
      resolution: 'ANSWERED',
      confidence: 0.9,
      quickReplies: [],
      metadata: {
        model: 'test-model',
        latencyMs: 10,
        sources: [],
        toolCalls: [],
        promptTokens: 1,
        completionTokens: 1,
      },
    }),
  };
  const turnLock = {
    claim: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const retrieval = { retrieve: jest.fn().mockResolvedValue([]) };
  const settings = {
    get: jest.fn().mockResolvedValue({
      coinRateVnd: 1000,
      bonusCoinExpiryDays: 30,
      coinTopUpMinVnd: 10000,
      coinTopUpMaxVnd: 10000000,
      subscriptionCancelWindowHours: 24,
      freeStarterEpisodeCount: 3,
      refundOnRemoval: true,
    }),
  };

  const service = new SupportChatService(
    config,
    { $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback({})) } as unknown as PrismaService,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    agent as unknown as SupportAgentService,
    {} as EscalationService,
    {} as ResolutionService,
    turnLock as unknown as SupportTurnLockService,
    retrieval as unknown as RetrievalService,
    new SummaryService(new PromptBuilderService()),
    settings as unknown as PlatformSettingService,
    {} as SupportRecipientsService,
    {} as AuditLogService,
  );

  return { service, create };
}

describe('SupportChatService redaction', () => {
  it('redacts OTP, card number and password from the AI reply before saving it', async () => {
    const reply =
      'Mã OTP: 123456. Số thẻ 1234567890123456. Mật khẩu: secret123. Bạn không nên chia sẻ các thông tin này.';
    const { service, create } = buildService(reply);

    await service.send('member-1', 'conversation-1', { content: 'OTP của tôi là 123456' });

    const aiCreate = create.mock.calls[1][0];
    expect(aiCreate.content).not.toContain('123456');
    expect(aiCreate.content).not.toContain('1234567890123456');
    expect(aiCreate.content).not.toContain('secret123');
    expect(aiCreate.content).toContain('****');
  });
});
