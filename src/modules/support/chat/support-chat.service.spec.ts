import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { Prisma, SupportSenderType, SupportStatus } from '@prisma/client';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { SupportAgentService, SupportAgentReply } from '../ai/support-agent.service';
import { SupportAiUnavailableError } from '../ai/ai-errors';
import { PromptBuilderService } from '../ai/prompt-builder';
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

const MEMBER_ID = 'member-1';
const CONVERSATION_ID = 'conversation-1';
const now = new Date('2026-11-09T00:00:00.000Z');

function conversationRow(overrides: Record<string, unknown> = {}) {
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

function messageRow(overrides: Record<string, unknown> = {}) {
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

const ANSWERED_REPLY: SupportAgentReply = {
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

function buildChatService() {
  const config = {
    support: {
      aiHistoryMessages: 20,
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

  const aiTurn = new SupportAiTurnService(
    config,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    agent as unknown as SupportAgentService,
    escalation as unknown as EscalationService,
    retrieval as unknown as RetrievalService,
    new SummaryService(new PromptBuilderService()),
    settings as unknown as PlatformSettingService,
  );

  const service = new SupportChatService(
    config,
    prisma,
    conversations as unknown as SupportConversationService,
    messages as unknown as SupportMessageService,
    aiTurn,
    escalation as unknown as EscalationService,
    {} as ResolutionService,
    turnLock as unknown as SupportTurnLockService,
    recipients as unknown as SupportRecipientsService,
    {} as AuditLogService,
  );

  return {
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

describe('SupportChatService redaction', () => {
  it('redacts OTP, card number and password from the AI reply before saving it', async () => {
    const reply =
      'Mã OTP: 123456. Số thẻ 1234567890123456. Mật khẩu: secret123. Bạn không nên chia sẻ các thông tin này.';
    const { service, messages, agent } = buildChatService();
    agent.reply.mockResolvedValue({ ...ANSWERED_REPLY, reply });

    await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'OTP của tôi là 123456' });

    const aiCreate = messages.create.mock.calls[1][0];
    expect(aiCreate.content).not.toContain('123456');
    expect(aiCreate.content).not.toContain('1234567890123456');
    expect(aiCreate.content).not.toContain('secret123');
    expect(aiCreate.content).toContain('****');
  });
});

describe('SupportChatService.send — validation and ownership', () => {
  it('rejects empty content', async () => {
    const { service, messages, agent } = buildChatService();
    await expect(service.send(MEMBER_ID, CONVERSATION_ID, { content: '   ' })).rejects.toMatchObject({ status: 400 });
    expect(messages.create).not.toHaveBeenCalled();
    expect(agent.reply).not.toHaveBeenCalled();
  });

  it('rejects content longer than the configured maximum', async () => {
    const { service, messages, agent } = buildChatService();
    await expect(service.send(MEMBER_ID, CONVERSATION_ID, { content: 'a'.repeat(4001) })).rejects.toMatchObject({
      status: 400,
    });
    expect(messages.create).not.toHaveBeenCalled();
    expect(agent.reply).not.toHaveBeenCalled();
  });

  it('propagates 404 when the case is not owned by the member', async () => {
    const { service, conversations } = buildChatService();
    conversations.findOwned.mockRejectedValue(new NotFoundException('Support conversation not found'));
    await expect(service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Xin chào' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects closed and resolved conversations before any write', async () => {
    const { service, conversations, messages } = buildChatService();
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED }));
    await expect(service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Xin chào' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));
    await expect(service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Xin chào' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(messages.create).not.toHaveBeenCalled();
  });
});

describe('SupportChatService.send — idempotency', () => {
  it('replays the earlier attempt for a duplicated clientMessageId without a second AI call', async () => {
    const { service, messages, agent, turnLock, conversations } = buildChatService();
    const existing = messageRow({ id: 'member-message', clientMessageId: 'msg-42' });
    messages.findByClientMessageId.mockResolvedValue(existing);
    messages.findAiReply.mockResolvedValue(messageRow({ id: 'ai-message', replyToMessageId: existing.id }));

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, {
      content: 'Số dư Coin của tôi?',
      clientMessageId: 'msg-42',
    });

    expect(messages.findByClientMessageId).toHaveBeenCalledWith(CONVERSATION_ID, 'msg-42');
    expect(messages.create).not.toHaveBeenCalled();
    expect(agent.reply).not.toHaveBeenCalled();
    expect(turnLock.claim).not.toHaveBeenCalled();
    expect(result.memberMessage.id).toBe('member-message');
    expect(result.aiMessage?.id).toBe('ai-message');
    expect(result.systemMessage).toBeNull();
    expect(conversations.findById).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it('checks the daily quota before replaying a duplicate', async () => {
    const { service, messages } = buildChatService();
    messages.countMemberMessagesSince.mockResolvedValue(200);

    await expect(
      service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?', clientMessageId: 'msg-42' }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(messages.findByClientMessageId).not.toHaveBeenCalled();
    expect(messages.create).not.toHaveBeenCalled();
  });

  it('surfaces a conflict instead of answering twice when a concurrent duplicate races the create', async () => {
    const { service, messages, agent, turnLock } = buildChatService();
    messages.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );

    await expect(
      service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?', clientMessageId: 'msg-42' }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(agent.reply).not.toHaveBeenCalled();
    expect(turnLock.claim).not.toHaveBeenCalled();
  });
});

describe('SupportChatService.send — daily quota', () => {
  it('blocks the send at the daily limit with 429', async () => {
    const { service, messages, agent, turnLock } = buildChatService();
    messages.countMemberMessagesSince.mockResolvedValue(200);

    const error = await service
      .send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(messages.countMemberMessagesSince).toHaveBeenCalledWith(MEMBER_ID, expect.any(Date));
    expect(messages.create).not.toHaveBeenCalled();
    expect(agent.reply).not.toHaveBeenCalled();
    expect(turnLock.claim).not.toHaveBeenCalled();
  });

  it('lets the send through below the limit', async () => {
    const { service, messages } = buildChatService();
    messages.countMemberMessagesSince.mockResolvedValue(199);

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?' });

    expect(result.aiMessage?.id).toBe('ai-message');
  });
});

describe('SupportChatService.send — turn lock', () => {
  it('hands the room to Staff and keeps the message when the lock is busy', async () => {
    const { service, turnLock, agent, escalation, messages } = buildChatService();
    turnLock.claim.mockResolvedValue(false);

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?' });

    expect(messages.create).toHaveBeenCalledTimes(1);
    expect(turnLock.claim).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(agent.reply).not.toHaveBeenCalled();
    expect(escalation.escalate).not.toHaveBeenCalled();
    expect(turnLock.release).not.toHaveBeenCalled();
    expect(result.memberMessage.id).toBe('member-message');
    expect(result.aiMessage).toBeNull();
    expect(result.quickReplies).toEqual(['CONFIRM_RESOLVED', 'REQUEST_STAFF']);
  });

  it('releases the lock after the AI turn (success and failure)', async () => {
    const { service, turnLock, agent } = buildChatService();
    await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?' });
    expect(turnLock.release).toHaveBeenCalledWith(CONVERSATION_ID);

    agent.reply.mockRejectedValue(new SupportAiUnavailableError('DISABLED', 'AI off'));
    turnLock.release.mockClear();
    await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Thêm một câu' });
    expect(turnLock.release).toHaveBeenCalledWith(CONVERSATION_ID);
  });
});

describe('SupportChatService.send — happy path', () => {
  it('passes the signed-in member and grounded turn to the agent and persists the star metadata', async () => {
    const { service, messages, agent, conversations, escalation } = buildChatService();

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Số dư Coin của tôi?' });

    expect(agent.reply).toHaveBeenCalledTimes(1);
    const agentCall = agent.reply.mock.calls[0] as [Record<string, unknown>] | undefined;
    if (!agentCall) throw new Error('Expected agent.reply to be called');
    const turn = agentCall[0];
    expect(turn.memberId).toBe(MEMBER_ID);
    expect(turn.conversationId).toBe(CONVERSATION_ID);
    expect(turn.message).toBe('Số dư Coin của tôi?');
    expect((turn.platformFacts as Record<string, unknown>).coinRateVnd).toBe(1000);
    expect(Array.isArray(turn.retrieved)).toBe(true);

    const aiCreate = messages.create.mock.calls[1][0];
    expect(aiCreate.senderType).toBe(SupportSenderType.AI_CHATBOT);
    expect(aiCreate.replyToMessageId).toBe('member-message');
    expect(aiCreate.aiMetadata).toMatchObject({ confidence: 0.9, resolution: 'ANSWERED', model: 'test-model' });

    expect(conversations.recordAiTurn).toHaveBeenCalledWith(CONVERSATION_ID, { suggestedResolution: false });
    expect(escalation.escalate).not.toHaveBeenCalled();
    expect(result.aiMessage?.id).toBe('ai-message');
  });

  it('routes non-AI_HANDLING cases to notify without an AI call', async () => {
    const { service, conversations, agent, turnLock, recipients, messages } = buildChatService();
    conversations.findById.mockResolvedValue(conversationRow({ status: SupportStatus.WAITING_FOR_STAFF }));

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Thêm câu hỏi' });

    expect(messages.create).toHaveBeenCalledTimes(1);
    expect(recipients.notifyMemberReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONVERSATION_ID, status: SupportStatus.WAITING_FOR_STAFF }),
      'Thêm câu hỏi',
    );
    expect(agent.reply).not.toHaveBeenCalled();
    expect(turnLock.claim).not.toHaveBeenCalled();
    expect(result.aiMessage).toBeNull();
    expect(result.quickReplies).toEqual([]);
  });
});

describe('SupportChatService.send — escalate rules', () => {
  it('escalates NEEDS_HUMAN with the LLM handoff summary and staff-made note', async () => {
    const { service, agent, escalation } = buildChatService();
    agent.reply.mockResolvedValue({
      ...ANSWERED_REPLY,
      resolution: 'NEEDS_HUMAN',
      escalationReason: 'INSUFFICIENT_INFO',
      handoffSummary: 'Member hỏi giao dịch Coin chưa thấy trong KB.',
      quickReplies: ['REQUEST_STAFF'],
    });

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Giao dịch Coin của tôi đâu?' });

    expect(escalation.escalate).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      reason: 'INSUFFICIENT_INFO',
      note: 'Member hỏi giao dịch Coin chưa thấy trong KB.',
      summary: 'Member hỏi giao dịch Coin chưa thấy trong KB.',
      actorId: null,
    });
    expect(result.conversation.status).toBe(SupportStatus.WAITING_FOR_STAFF);
    expect(result.aiMessage?.id).toBe('ai-message');
    expect(result.quickReplies).toEqual(['REQUEST_STAFF']);
  });

  it('falls back to STAFF_NEEDED when the LLM escalates without a reason', async () => {
    const { service, agent, escalation } = buildChatService();
    agent.reply.mockResolvedValue({ ...ANSWERED_REPLY, resolution: 'UNCERTAIN', escalationReason: undefined });

    await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Cái này là gì?' });

    expect(escalation.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STAFF_NEEDED', actorId: null }),
    );
  });

  it('escalates AI_UNAVAILABLE with redacted summary when the agent is down', async () => {
    const { service, agent, escalation, messages, conversations } = buildChatService();
    agent.reply.mockRejectedValue(new SupportAiUnavailableError('DISABLED', 'AI_MODE=disabled'));

    const result = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Xin chào' });

    expect(conversations.recordAiFailure).toHaveBeenCalledTimes(1);
    expect(escalation.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'AI_UNAVAILABLE', actorId: null }),
    );
    const escalationCall = escalation.escalate.mock.calls[0] as [{ note: string }] | undefined;

    if (!escalationCall) {
      throw new Error('Expected escalation.escalate to be called');
    }
    const escalateInput = escalationCall[0];
    expect(escalateInput.note).toContain('AI không thể trả lời (DISABLED)');
    expect(result.aiMessage).toBeNull();
    expect(messages.create).toHaveBeenCalledTimes(1);
  });

  it('soft-fails the first generic provider error and escalates on the second', async () => {
    const { service, agent, escalation, conversations } = buildChatService();
    agent.reply.mockRejectedValue(new Error('provider 500'));

    // First failure: fallback reply for the member, no escalation.
    conversations.recordAiFailure.mockResolvedValue(1);
    const first = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Câu 1' });
    expect(escalation.escalate).not.toHaveBeenCalled();
    expect(first.aiMessage).toBeNull();
    expect(first.quickReplies).toEqual(['CONFIRM_RESOLVED', 'REQUEST_STAFF']);

    // Second consecutive failure: hand the case to Staff as PROVIDER_ERROR.
    escalation.escalate.mockClear();
    conversations.recordAiFailure.mockResolvedValue(2);
    const second = await service.send(MEMBER_ID, CONVERSATION_ID, { content: 'Câu 2' });
    expect(escalation.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'AI_UNAVAILABLE', actorId: null }),
    );
    expect(second.aiMessage).toBeNull();
  });

  it('escalates MEMBER_REQUEST straight away when the member asks for a human', async () => {
    const { service, escalation, conversations } = buildChatService();

    const result = await service.requestStaff(MEMBER_ID, CONVERSATION_ID, 'Tôi muốn gặp nhân viên');

    expect(conversations.findOwned).toHaveBeenCalledWith(CONVERSATION_ID, MEMBER_ID);
    const escalationCall = escalation.escalate.mock.calls[0] as
      [{ reason: string; actorId: string; note: string }] | undefined;

    if (!escalationCall) {
      throw new Error('Expected escalation.escalate to be called');
    }
    const input = escalationCall[0];
    expect(input.reason).toBe('MEMBER_REQUEST');
    expect(input.actorId).toBe(MEMBER_ID);
    expect(input.note).toContain('Tôi muốn gặp nhân viên');
    expect(result.systemMessage).toBeNull();
  });

  it('refuses requestStaff on closed or resolved cases', async () => {
    const { service, conversations } = buildChatService();
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED }));
    await expect(service.requestStaff(MEMBER_ID, CONVERSATION_ID)).rejects.toBeInstanceOf(ConflictException);

    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));
    await expect(service.requestStaff(MEMBER_ID, CONVERSATION_ID)).rejects.toBeInstanceOf(ConflictException);
  });
});
