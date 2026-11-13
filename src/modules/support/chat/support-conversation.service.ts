import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportConversation, SupportSenderType, SupportStatus } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { assertStatusTransition, OPEN_SUPPORT_STATUSES } from '../shared/support-status';

/** A member has at most one case that is not CLOSED (partial unique index in the migration). */
const NOT_CLOSED = { status: { not: SupportStatus.CLOSED } } satisfies Prisma.SupportConversationWhereInput;

@Injectable()
export class SupportConversationService {
  constructor(private readonly prisma: PrismaService) {}

  findOpenByMember(memberId: string, tx?: PrismaTx): Promise<SupportConversation | null> {
    return (tx ?? this.prisma).supportConversation.findFirst({
      where: { memberId, ...NOT_CLOSED },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, tx?: PrismaTx): Promise<SupportConversation> {
    const conversation = await (tx ?? this.prisma).supportConversation.findUnique({ where: { id } });
    if (!conversation) throw new NotFoundException('Support conversation not found');
    return conversation;
  }

  /** 404 rather than 403 when the case belongs to someone else, so its existence does not leak. */
  async findOwned(id: string, memberId: string): Promise<SupportConversation> {
    const conversation = await this.prisma.supportConversation.findFirst({
      where: { id, memberId },
    });
    if (!conversation) throw new NotFoundException('Support conversation not found');
    return conversation;
  }

  /**
   * Opens the member's case or returns the one still open. Two taps racing past the partial
   * unique index both land here: the loser re-reads and gets the winner's row.
   */
  async openForMember(memberId: string): Promise<{ conversation: SupportConversation; created: boolean }> {
    const open = await this.findOpenByMember(memberId);
    if (open) return { conversation: open, created: false };
    try {
      const conversation = await this.prisma.supportConversation.create({
        data: { memberId, status: SupportStatus.AI_HANDLING },
      });
      return { conversation, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findOpenByMember(memberId);
        if (winner) return { conversation: winner, created: false };
      }
      throw error;
    }
  }

  /** Bumps the sort columns every message write updates; the queue orders on them. */
  async touchMessages(
    conversationId: string,
    senderType: SupportSenderType,
    at = new Date(),
    tx?: PrismaTx,
  ): Promise<void> {
    await (tx ?? this.prisma).supportConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: at,
        ...(senderType === 'MEMBER' ? { lastMemberMessageAt: at } : {}),
        ...(senderType === 'SUPPORT_AGENT' ? { lastStaffMessageAt: at } : {}),
      },
    });
  }

  /**
   * Guarded status move: the caller names the statuses it believes the case is in, so two
   * Staff taps (claim vs close) cannot both win. Throws 409 when nobody matched.
   */
  async transition(
    id: string,
    from: SupportStatus | readonly SupportStatus[],
    to: SupportStatus,
    data: Omit<Prisma.SupportConversationUncheckedUpdateManyInput, 'status'> = {},
    tx?: PrismaTx,
  ): Promise<SupportConversation> {
    const allowedFrom: SupportStatus[] = typeof from === 'string' ? [from] : [...from];
    if (allowedFrom.length === 1) assertStatusTransition(allowedFrom[0], to);
    const client = tx ?? this.prisma;
    const { count } = await client.supportConversation.updateMany({
      where: { id, status: { in: [...allowedFrom] } },
      data: { ...data, status: to },
    });
    if (count === 0) {
      const current = await client.supportConversation.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundException('Support conversation not found');
      if (current.status === to) return this.findById(id, tx); // idempotent replay
      throw new ConflictException(`Support case cannot move from ${current.status} to ${to}`);
    }
    return this.findById(id, tx);
  }

  /** Member/Staff unread badge (plan §3.1); only the columns the badge reads. */
  async markRead(id: string, reader: 'member' | 'staff'): Promise<void> {
    await this.prisma.supportConversation.update({
      where: { id },
      data: reader === 'member' ? { memberLastReadAt: new Date() } : { staffLastReadAt: new Date() },
    });
  }

  /** One AI answer is done: bump the turn counter and restart or clear the inactivity clock. */
  async recordAiTurn(id: string, options: { suggestedResolution: boolean }): Promise<void> {
    await this.prisma.supportConversation.update({
      where: { id },
      data: {
        aiTurns: { increment: 1 },
        aiFailureCount: 0,
        aiResolutionSuggestedAt: options.suggestedResolution ? new Date() : null,
      },
    });
  }

  /** Returns the new consecutive failure count so the caller can escalate on the second one. */
  async recordAiFailure(id: string): Promise<number> {
    const conversation = await this.prisma.supportConversation.update({
      where: { id },
      data: { aiFailureCount: { increment: 1 } },
      select: { aiFailureCount: true },
    });
    return conversation.aiFailureCount;
  }

  isOpen(status: SupportStatus): boolean {
    return OPEN_SUPPORT_STATUSES.includes(status);
  }
}
