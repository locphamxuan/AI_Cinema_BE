import { Injectable } from '@nestjs/common';
import { SupportCloseReason, SupportEscalationReason, SupportStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';

/**
 * The Staff dashboard numbers (plan A8.4): queue depth, today's flow and how much of the last 30
 * days the assistant closed on its own. Read-only, so it never touches a case row.
 */
@Injectable()
export class SupportStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Plan A8.4 dashboard; the counts are of the whole platform, not one operator. */
  async stats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWindow = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60_000);

    const [byStatus, oldestWaiting, escalatedToday, resolvedToday, closedWindow, closedByAi, reasons] =
      await Promise.all([
        this.prisma.supportConversation.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.supportConversation.findFirst({
          where: { status: SupportStatus.WAITING_FOR_STAFF },
          orderBy: { escalatedAt: 'asc' },
          select: { id: true, escalatedAt: true, createdAt: true, priority: true },
        }),
        this.prisma.supportConversation.count({ where: { escalatedAt: { gte: startOfToday } } }),
        this.prisma.supportConversation.count({ where: { resolvedAt: { gte: startOfToday } } }),
        this.prisma.supportConversation.count({
          where: { status: SupportStatus.CLOSED, closedAt: { gte: startOfWindow } },
        }),
        this.prisma.supportConversation.count({
          where: {
            status: SupportStatus.CLOSED,
            closeReason: SupportCloseReason.AI_RESOLVED,
            closedAt: { gte: startOfWindow },
          },
        }),
        this.prisma.supportConversation.groupBy({
          by: ['escalationReason'],
          where: { escalationReason: { not: null }, escalatedAt: { gte: startOfWindow } },
          _count: { _all: true },
        }),
      ]);

    const counts = Object.fromEntries(Object.values(SupportStatus).map((status) => [status, 0])) as Record<
      SupportStatus,
      number
    >;
    for (const row of byStatus) counts[row.status] = row._count._all;

    const waitingSince = oldestWaiting?.escalatedAt ?? oldestWaiting?.createdAt ?? null;

    return {
      byStatus: counts,
      waiting: counts[SupportStatus.WAITING_FOR_STAFF] ?? 0,
      oldestWaiting: oldestWaiting
        ? {
            conversationId: oldestWaiting.id,
            priority: oldestWaiting.priority,
            waitingMinutes: waitingSince ? Math.max(0, Math.round((Date.now() - waitingSince.getTime()) / 60_000)) : 0,
          }
        : null,
      escalatedToday,
      resolvedToday,
      aiResolvedRate: closedWindow ? Math.round((closedByAi / closedWindow) * 1000) / 1000 : 0,
      topEscalationReasons: reasons
        .filter((row): row is typeof row & { escalationReason: SupportEscalationReason } =>
          Boolean(row.escalationReason),
        )
        .map((row) => ({ reason: row.escalationReason, count: row._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }
}
