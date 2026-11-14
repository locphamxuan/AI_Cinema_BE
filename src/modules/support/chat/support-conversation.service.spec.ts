import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, SupportSenderType, SupportStatus, type SupportConversation } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { SupportConversationService } from './support-conversation.service';

const MEMBER_ID = 'member-1';
const CONVERSATION_ID = 'conversation-1';

function conversationRow(overrides: Partial<SupportConversation> = {}): SupportConversation {
  return {
    id: CONVERSATION_ID,
    memberId: MEMBER_ID,
    status: SupportStatus.AI_HANDLING,
    claimedById: null,
    staffAssigneeId: null,
    escalationReason: null,
    aiSummary: null,
    aiTurns: 0,
    aiFailureCount: 0,
    aiResolutionSuggestedAt: null,
    memberLastReadAt: null,
    staffLastReadAt: null,
    lastMessageAt: null,
    lastMemberMessageAt: null,
    lastStaffMessageAt: null,
    resolvedAt: null,
    closedAt: null,
    closeReason: null,
    satisfactionRating: null,
    satisfactionComment: null,
    createdAt: new Date('2026-11-09'),
    updatedAt: new Date('2026-11-09'),
    ...overrides,
  } as SupportConversation;
}

function buildService() {
  const prisma = {
    supportConversation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new SupportConversationService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('SupportConversationService.openForMember', () => {
  it('opens the one open case for the member (CLOSED does not count as open)', async () => {
    const { service, prisma } = buildService();
    const open = conversationRow({ status: SupportStatus.WAITING_FOR_STAFF });
    prisma.supportConversation.findFirst.mockResolvedValue(open);

    const result = await service.openForMember(MEMBER_ID);

    expect(prisma.supportConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { memberId: MEMBER_ID, status: { not: SupportStatus.CLOSED } } }),
    );
    expect(prisma.supportConversation.create).not.toHaveBeenCalled();
    expect(result).toEqual({ conversation: open, created: false });
  });

  it('creates a fresh case in AI_HANDLING when the member has none open', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findFirst.mockResolvedValue(null);
    const created = conversationRow({ status: SupportStatus.AI_HANDLING });
    prisma.supportConversation.create.mockResolvedValue(created);

    const result = await service.openForMember(MEMBER_ID);

    expect(prisma.supportConversation.create).toHaveBeenCalledWith({
      data: { memberId: MEMBER_ID, status: SupportStatus.AI_HANDLING },
    });
    expect(result).toEqual({ conversation: created, created: true });
  });

  it('returns the winner when two requests race past the partial unique index (P2002)', async () => {
    const { service, prisma } = buildService();
    const winner = conversationRow();
    prisma.supportConversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    prisma.supportConversation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );

    const result = await service.openForMember(MEMBER_ID);

    expect(prisma.supportConversation.findFirst).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ conversation: winner, created: false });
  });

  it('rethrows a create failure when the race loser is not readable', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findFirst.mockResolvedValue(null);
    const failure = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    prisma.supportConversation.create.mockRejectedValue(failure);

    await expect(service.openForMember(MEMBER_ID)).rejects.toBe(failure);
  });

  it('propagates non-unique create errors instead of swallowing them', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findFirst.mockResolvedValue(null);
    const failure = new Error('db down');
    prisma.supportConversation.create.mockRejectedValue(failure);

    await expect(service.openForMember(MEMBER_ID)).rejects.toBe(failure);
    expect(prisma.supportConversation.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('SupportConversationService.findOwned (ownership)', () => {
  it('returns the case only when it belongs to the member', async () => {
    const { service, prisma } = buildService();
    const row = conversationRow();
    prisma.supportConversation.findFirst.mockResolvedValue(row);

    await expect(service.findOwned(CONVERSATION_ID, MEMBER_ID)).resolves.toBe(row);
    expect(prisma.supportConversation.findFirst).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, memberId: MEMBER_ID },
    });
  });

  it('answers 404 (not 403) for another member case so its existence does not leak', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findFirst.mockResolvedValue(null);

    const error = await service.findOwned(CONVERSATION_ID, MEMBER_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('Support conversation not found');
  });

  it('answers 404 the same way for a missing case', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.findFirst.mockResolvedValue(null);

    await expect(service.findById('ghost-conversation')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.supportConversation.findUnique).toHaveBeenCalledWith({ where: { id: 'ghost-conversation' } });
  });
});

describe('SupportConversationService.transition (state machine)', () => {
  it('moves a case along a valid single-from transition', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
    const moved = conversationRow({ status: SupportStatus.WAITING_FOR_STAFF });
    prisma.supportConversation.findUnique.mockResolvedValue(moved);

    const result = await service.transition(
      CONVERSATION_ID,
      SupportStatus.AI_HANDLING,
      SupportStatus.WAITING_FOR_STAFF,
    );

    expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, status: { in: [SupportStatus.AI_HANDLING] } },
      data: { status: SupportStatus.WAITING_FOR_STAFF },
    });
    expect(result).toBe(moved);
  });

  it('refuses a move the lifecycle forbids before touching the db', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.transition(CONVERSATION_ID, SupportStatus.CLOSED, SupportStatus.WAITING_FOR_STAFF),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.supportConversation.updateMany).not.toHaveBeenCalled();
  });

  it('moves when the caller guards on several from-statuses (claim vs close race)', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.supportConversation.findUnique.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));

    const result = await service.transition(
      CONVERSATION_ID,
      [SupportStatus.WAITING_FOR_STAFF, SupportStatus.STAFF_HANDLING],
      SupportStatus.RESOLVED,
      { resolvedAt: new Date('2026-11-09') },
    );

    expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID, status: { in: [SupportStatus.WAITING_FOR_STAFF, SupportStatus.STAFF_HANDLING] } },
      data: { resolvedAt: expect.any(Date), status: SupportStatus.RESOLVED },
    });
    expect(result.status).toBe(SupportStatus.RESOLVED);
  });

  it('throws 409 when the guarded update matches nothing and the case sits elsewhere', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.supportConversation.findUnique.mockResolvedValue({ status: SupportStatus.CLOSED });

    const error = await service
      .transition(CONVERSATION_ID, SupportStatus.WAITING_FOR_STAFF, SupportStatus.RESOLVED)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      `Support case cannot move from ${SupportStatus.CLOSED} to ${SupportStatus.RESOLVED}`,
    );
  });

  it('replays idempotently when the case is already at the target', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.supportConversation.findUnique
      .mockResolvedValueOnce({ status: SupportStatus.CLOSED })
      .mockResolvedValueOnce(conversationRow({ status: SupportStatus.CLOSED }));

    const result = await service.transition(CONVERSATION_ID, SupportStatus.RESOLVED, SupportStatus.CLOSED);

    expect(result.status).toBe(SupportStatus.CLOSED);
  });

  it('throws 404 when the guarded update matches nothing and the case is gone', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.supportConversation.findUnique.mockResolvedValue(null);

    await expect(
      service.transition(CONVERSATION_ID, SupportStatus.RESOLVED, SupportStatus.CLOSED),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupportConversationService — counters and reads', () => {
  it('touches only the member sort column for member messages', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.update.mockResolvedValue(undefined);
    const at = new Date('2026-11-09T08:00:00Z');

    await service.touchMessages(CONVERSATION_ID, SupportSenderType.MEMBER, at);

    expect(prisma.supportConversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastMessageAt: at, lastMemberMessageAt: at },
    });
  });

  it('touches the staff column for staff messages', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.update.mockResolvedValue(undefined);

    await service.touchMessages(CONVERSATION_ID, SupportSenderType.SUPPORT_AGENT);

    expect(prisma.supportConversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { lastMessageAt: expect.any(Date), lastStaffMessageAt: expect.any(Date) },
    });
  });

  it('records the read column for member vs staff', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.update.mockResolvedValue(undefined);

    await service.markRead(CONVERSATION_ID, 'member');
    await service.markRead(CONVERSATION_ID, 'staff');

    expect(prisma.supportConversation.update).toHaveBeenCalledTimes(2);
    expect(prisma.supportConversation.update).toHaveBeenNthCalledWith(1, {
      where: { id: CONVERSATION_ID },
      data: { memberLastReadAt: expect.any(Date) },
    });
    expect(prisma.supportConversation.update).toHaveBeenNthCalledWith(2, {
      where: { id: CONVERSATION_ID },
      data: { staffLastReadAt: expect.any(Date) },
    });
  });

  it('records a turn: bumps aiTurns, clears failures, keeps or clears the suggestion stamp', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.update.mockResolvedValue(undefined);

    await service.recordAiTurn(CONVERSATION_ID, { suggestedResolution: true });
    await service.recordAiTurn(CONVERSATION_ID, { suggestedResolution: false });

    expect(prisma.supportConversation.update).toHaveBeenNthCalledWith(1, {
      where: { id: CONVERSATION_ID },
      data: { aiTurns: { increment: 1 }, aiFailureCount: 0, aiResolutionSuggestedAt: expect.any(Date) },
    });
    expect(prisma.supportConversation.update).toHaveBeenNthCalledWith(2, {
      where: { id: CONVERSATION_ID },
      data: { aiTurns: { increment: 1 }, aiFailureCount: 0, aiResolutionSuggestedAt: null },
    });
  });

  it('returns the new consecutive failure count', async () => {
    const { service, prisma } = buildService();
    prisma.supportConversation.update.mockResolvedValue({ aiFailureCount: 2 });

    await expect(service.recordAiFailure(CONVERSATION_ID)).resolves.toBe(2);
    expect(prisma.supportConversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION_ID },
      data: { aiFailureCount: { increment: 1 } },
      select: { aiFailureCount: true },
    });
  });

  it('treats RESOLVED as still open and CLOSED as the only closed state', () => {
    const { service } = buildService();

    expect(service.isOpen(SupportStatus.AI_HANDLING)).toBe(true);
    expect(service.isOpen(SupportStatus.WAITING_FOR_STAFF)).toBe(true);
    expect(service.isOpen(SupportStatus.STAFF_HANDLING)).toBe(true);
    expect(service.isOpen(SupportStatus.RESOLVED)).toBe(true);
    expect(service.isOpen(SupportStatus.CLOSED)).toBe(false);
  });
});
