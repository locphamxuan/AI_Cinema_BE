import { Injectable } from '@nestjs/common';
import { Prisma, SupportMessage, SupportSenderType } from '@prisma/client';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';

export interface CreateSupportMessage {
  conversationId: string;
  senderType: SupportSenderType;
  senderId?: string | null;
  content: string;
  isInternal?: boolean;
  clientMessageId?: string | null;
  replyToMessageId?: string | null;
  aiMetadata?: Prisma.InputJsonValue;
}

@Injectable()
export class SupportMessageService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateSupportMessage, tx?: PrismaTx): Promise<SupportMessage> {
    return (tx ?? this.prisma).supportMessage.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        content: input.content,
        isInternal: input.isInternal ?? false,
        clientMessageId: input.clientMessageId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        aiMetadata: input.aiMetadata,
      },
    });
  }

  /** Idempotency: a retried send finds the row its first attempt already wrote. */
  findByClientMessageId(conversationId: string, clientMessageId: string): Promise<SupportMessage | null> {
    return this.prisma.supportMessage.findUnique({
      where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
    });
  }

  /** The one AI answer to a member message (`reply_to_message_id` is unique). */
  findAiReply(memberMessageId: string): Promise<SupportMessage | null> {
    return this.prisma.supportMessage.findUnique({ where: { replyToMessageId: memberMessageId } });
  }

  /**
   * Newest first for the member app; `before` pages backwards without an offset.
   * Member reads never see internal Staff notes.
   */
  async listForConversation(
    conversationId: string,
    options: { limit?: number; before?: Date; includeInternal?: boolean } = {},
  ): Promise<SupportMessage[]> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    return this.prisma.supportMessage.findMany({
      where: {
        conversationId,
        ...(options.includeInternal ? {} : { isInternal: false }),
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /** The tail of the transcript handed to the LLM, oldest first. */
  async recentForAi(conversationId: string, take: number): Promise<SupportMessage[]> {
    const rows = await this.prisma.supportMessage.findMany({
      where: { conversationId, isInternal: false },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.reverse();
  }

  /** Daily quota (plan §5.6): member messages across all their cases since midnight. */
  countMemberMessagesSince(memberId: string, since: Date): Promise<number> {
    return this.prisma.supportMessage.count({
      where: {
        senderType: SupportSenderType.MEMBER,
        createdAt: { gte: since },
        conversation: { memberId },
      },
    });
  }

  countStaffReplies(conversationId: string): Promise<number> {
    return this.prisma.supportMessage.count({
      where: { conversationId, senderType: SupportSenderType.SUPPORT_AGENT, isInternal: false },
    });
  }
}
