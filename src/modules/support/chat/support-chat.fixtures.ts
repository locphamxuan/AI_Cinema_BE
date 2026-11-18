/** The SupportChatService under test with every collaborator mocked, shared by the chat specs. */
import { SupportSenderType, SupportStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { SupportAgentService, SupportAgentReply } from '../ai/support-agent.service';
import { PromptBuilderService } from '../ai/prompt-builder';
import { HandoffSummaryAiService } from '../ai/handoff-summary-ai.service';
import { SummaryService } from '../ai/summary.service';
import type { RetrievalService } from '../knowledge/retrieval.service';
import type { SupportRecipientsService } from '../staff/support-recipients.service';
import type { EscalationService } from './escalation.service';
import type { ResolutionService } from './resolution.service';
import { SupportChatService } from './support-chat.service';
import { SupportAiTurnService } from './support-ai-turn.service';
import type { SupportConversationService } from './support-conversation.service';
import type { SupportMessageService } from './support-message.service';
import type { SupportTurnLockService } from './support-turn-lock.service';

export const MEMBER_ID = 'member-1';
export const CONVERSATION_ID = 'conversation-1';
export const now = new Date('2026-11-09T00:00:00.000Z');

export function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    memberId: MEMBER_ID,
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

export function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    conversationId: CONVERSATION_ID,
    senderType: SupportSenderType.MEMBER,
    senderId: MEMBER_ID,
    content: 'Số dư Coin của tôi là bao nhiêu?',
    isInternal: false,
    clientMessageId: null,
    replyToMessageId: null,
    aiMetadata: null,
    createdAt: now,
    ...overrides,
  };
}

export const ANSWERED_REPLY: SupportAgentReply = {
  reply: 'Số dư Coin chính của bạn là 100.',
  resolution: 'ANSWERED',
  confidence: 0.9,
  quickReplies: [],
  metadata: {
    model: 'test-model',
    latencyMs: 12,
    sources: [{ articleId: 'article-1', title: 'Coin', heading: 'Số dư' }],
    toolCalls: [{ name: 'get_member_wallet', arguments: {}, result: { ok: true, data: { mainBalance: 100 } } }],
    promptTokens: 10,
    completionTokens: 5,
  },
};

export function buildChatService() {
  const config = {
    support: {
      aiHistoryMessages: 20,
      aiTurnDeadlineMs: 1000,
      ragTopK: 6,
      ragMinScore: 0.35,
      dailyMessageLimit: 200,
      messageMaxChars: 4000,
    },
  } as unknown as AppConfig;

  const memberMessage = messageRow({ id: 'member-message', content: 'Số dư Coin của tôi là bao nhiêu?' });
  const aiMessage = messageRow({
    id: 'ai-message',
    senderType: SupportSenderType.AI_CHATBOT,
    senderId: null,
    content: ANSWERED_REPLY.reply,
    replyToMessageId: memberMessage.id,
  });

  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback({})),
  } as unknown as PrismaService;

  const conversations = {
    findOwned: jest.fn().mockResolvedValue(conversationRow()),
    findById: jest.fn().mockResolvedValue(conversationRow()),
    touchMessages: jest.fn().mockResolvedValue(undefined),
    recordAiTurn: jest.fn().mockResolvedValue(undefined),
    recordAiFailure: jest.fn().mockResolvedValue(1),
  };

  const create = jest.fn((input: Record<string, unknown>) =>
    Promise.resolve(input.senderType === SupportSenderType.MEMBER ? memberMessage : aiMessage),
  );
  const messages = {
    findByClientMessageId: jest.fn().mockResolvedValue(null),
    findAiReply: jest.fn().mockResolvedValue(null),
    create,
    recentForAi: jest.fn().mockResolvedValue([memberMessage]),
    countMemberMessagesSince: jest.fn().mockResolvedValue(0),
  };

  const agent = { reply: jest.fn().mockResolvedValue(ANSWERED_REPLY) };
  const escalation = {
    escalate: jest.fn().mockResolvedValue({
      conversation: conversationRow({ status: SupportStatus.WAITING_FOR_STAFF }),
      systemMessage: null,
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
  const recipients = { notifyMemberReply: jest.fn().mockResolvedValue(undefined) };
  const handoffAi = { summarize: jest.fn().mockResolvedValue(null) };
  const resolution = {
    reopen: jest.fn(),
    aiResolved: jest.fn().mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED })),
    staffResolutionConfirmed: jest.fn().mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED })),
  };

  const aiTurn = new SupportAiTurnService(
    config,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    agent as unknown as SupportAgentService,
    escalation as unknown as EscalationService,
    retrieval as unknown as RetrievalService,
    new SummaryService(new PromptBuilderService()),
    settings as unknown as PlatformSettingService,
    handoffAi as unknown as HandoffSummaryAiService,
  );

  const service = new SupportChatService(
    config,
    prisma,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    aiTurn,
    escalation as unknown as EscalationService,
    resolution as unknown as ResolutionService,
    turnLock as unknown as SupportTurnLockService,
    recipients as unknown as SupportRecipientsService,
    {} as AuditLogService,
    handoffAi as unknown as HandoffSummaryAiService,
  );

  return {
    resolution,
    handoffAi,
    service,
    prisma,
    conversations,
    messages,
    agent,
    escalation,
    turnLock,
    retrieval,
    recipients,
    memberMessage,
    aiMessage,
  };
}
