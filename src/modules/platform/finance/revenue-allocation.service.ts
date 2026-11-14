import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { periodOf, periodRange, type PeriodRange } from './finance-period';

interface MovieWatch {
  movieId: string;
  seconds: bigint;
}

export interface AllocationShare extends MovieWatch {
  allocatedVnd: bigint;
}

/**
 * Splits `poolVnd` by watch seconds, rounding down, then hands the VND lost to rounding to the movies with the
 * largest remainders one by one, so the shares always add up to the pool.
 */
export function splitPool(poolVnd: bigint, watches: MovieWatch[]): AllocationShare[] {
  const total = watches.reduce((sum, w) => sum + w.seconds, 0n);
  if (total === 0n || poolVnd <= 0n) return watches.map((w) => ({ ...w, allocatedVnd: 0n }));
  const shares = watches.map((w) => ({
    ...w,
    allocatedVnd: (poolVnd * w.seconds) / total,
    remainder: (poolVnd * w.seconds) % total,
  }));
  let left = poolVnd - shares.reduce((sum, s) => sum + s.allocatedVnd, 0n);
  const byRemainder = [...shares].sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0));
  for (const share of byRemainder) {
    if (left === 0n) break;
    share.allocatedVnd += 1n;
    left -= 1n;
  }
  return shares.map((s) => ({ movieId: s.movieId, seconds: s.seconds, allocatedVnd: s.allocatedVnd }));
}

/**
 * BR-48: the Monthly-plan revenue of a month belongs to no movie; once the month is over it is shared across
 * movies by the watch seconds of plan members (streaming sessions opened with SUBSCRIPTION access). The pool
 * counts main Coins only, at the rate of each payment (BR-49, BR-50). Re-running a month replaces its rows.
 */
@Injectable()
export class RevenueAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async allocate(period: string, actorId: string | null, now = new Date()) {
    const range = periodRange(period);
    if (period >= periodOf(now)) throw new ConflictException('Only a month that is over can be allocated');
    const [poolVnd, watches] = await Promise.all([this.pool(range), this.watches(range)]);
    const shares = splitPool(poolVnd, watches);
    const totalSeconds = watches.reduce((sum, w) => sum + w.seconds, 0n);
    await this.prisma.$transaction(async (tx) => {
      await tx.revenueAllocation.deleteMany({ where: { period } });
      if (shares.length) {
        await tx.revenueAllocation.createMany({
          data: shares.map((s) => ({
            period,
            movieId: s.movieId,
            movieWatchSeconds: s.seconds,
            totalWatchSeconds: totalSeconds,
            monthlyPoolVnd: poolVnd,
            allocatedVnd: s.allocatedVnd,
          })),
        });
      }
      await this.audit.record(
        {
          action: CONTENT_EVENT.REVENUE_ALLOCATED,
          entityType: 'RevenueAllocation',
          // audit_logs.entity_id is a UUID: each run gets its own id, the month travels in the payload.
          entityId: randomUUID(),
          projectId: null,
          actorId,
          payload: { period, poolVnd: poolVnd.toString(), movies: shares.length },
        },
        tx,
      );
    });
    return this.list(period);
  }

  /** The scheduler: allocates a finished month once, as soon as it has Monthly-plan payments. */
  async allocateIfMissing(period: string, now = new Date()): Promise<boolean> {
    if (await this.prisma.revenueAllocation.count({ where: { period } })) return false;
    if ((await this.pool(periodRange(period))) === 0n) return false;
    await this.allocate(period, null, now);
    return true;
  }

  async list(period: string) {
    periodRange(period);
    const rows = await this.prisma.revenueAllocation.findMany({
      where: { period },
      include: { movie: { select: { id: true, title: true } } },
      orderBy: { allocatedVnd: 'desc' },
    });
    const first = rows[0];
    return {
      period,
      monthlyPoolVnd: Number(first?.monthlyPoolVnd ?? 0n),
      totalWatchSeconds: Number(first?.totalWatchSeconds ?? 0n),
      allocatedAt: first?.createdAt ?? null,
      movies: rows.map((r) => ({
        movieId: r.movieId,
        title: r.movie.title,
        watchSeconds: Number(r.movieWatchSeconds),
        sharePercent: r.totalWatchSeconds ? Number((r.movieWatchSeconds * 10000n) / r.totalWatchSeconds) / 100 : 0,
        allocatedVnd: Number(r.allocatedVnd),
      })),
    };
  }

  /** Main Coins paid for Monthly plans in the month, in VND (bonus Coins are promotion cost, BR-49). */
  private async pool({ from, to }: PeriodRange): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<{ vnd: bigint | null }[]>(Prisma.sql`
      SELECT SUM(sc.main_coins_charged::bigint * ct.rate_vnd)::bigint AS vnd
      FROM subscription_cycles sc
      JOIN coin_transactions ct ON ct.id = sc.coin_transaction_id
      WHERE sc.status = 'PAID' AND sc.attempted_at >= ${from} AND sc.attempted_at < ${to}`);
    return row?.vnd ?? 0n;
  }

  /** Watch seconds of plan members per movie in the month. */
  private async watches({ from, to }: PeriodRange): Promise<MovieWatch[]> {
    const rows = await this.prisma.$queryRaw<{ movie_id: string; seconds: bigint }[]>(Prisma.sql`
      SELECT e.movie_id, SUM(ss.total_watched_seconds)::bigint AS seconds
      FROM streaming_sessions ss
      JOIN episodes e ON e.id = ss.episode_id
      WHERE ss.access_type = 'SUBSCRIPTION' AND ss.user_id IS NOT NULL
        AND ss.started_at >= ${from} AND ss.started_at < ${to}
      GROUP BY e.movie_id
      HAVING SUM(ss.total_watched_seconds) > 0
      ORDER BY seconds DESC`);
    return rows.map((r) => ({ movieId: r.movie_id, seconds: r.seconds }));
  }
}
