import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

/** A turn left behind by a crashed request stops blocking the next one after this long. */
const STALE_TURN_MS = 120_000;

/**
 * One AI turn per conversation (plan §5.6): `ai_turn_started_at` is claimed with a guarded
 * UPDATE, so a double-sent message cannot run two LLM calls over the same transcript.
 */
@Injectable()
export class SupportTurnLockService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(conversationId: string, now = new Date()): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - STALE_TURN_MS);
    const { count } = await this.prisma.supportConversation.updateMany({
      where: {
        id: conversationId,
        OR: [{ aiTurnStartedAt: null }, { aiTurnStartedAt: { lt: staleBefore } }],
      },
      data: { aiTurnStartedAt: now },
    });
    return count === 1;
  }

  async release(conversationId: string): Promise<void> {
    await this.prisma.supportConversation.updateMany({
      where: { id: conversationId },
      data: { aiTurnStartedAt: null },
    });
  }
}
