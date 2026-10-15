import { AccessSource } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';

/** Reason written on a top-up booked because the Reviewer approved a Creator's Token request. */
export const CREATOR_REQUEST_REASON_PREFIX = 'Theo yêu cầu của';

/**
 * Tabs of the Reviewer's Token history: what the Admin did (MF-1 budget), what went into projects (by season),
 * the part of it the Reviewer gave because a Creator asked, and the Coin viewers spent on those projects (MF-2).
 */
export type TokenHistoryCategory = 'ADMIN' | 'PROJECT' | 'CREATOR_REQUEST';

export function feeCategory(reason: string | null): TokenHistoryCategory {
  return reason?.startsWith(CREATOR_REQUEST_REASON_PREFIX) ? 'CREATOR_REQUEST' : 'PROJECT';
}

const ACTIVITY_LIMIT = 200;

/** MF-2 seen from the Reviewer: Coin viewers paid to unlock episodes of the Reviewer's movies, and refunds. */
export async function coinActivity(prisma: PrismaService, reviewerId: string) {
  const accesses = await prisma.episodeAccess.findMany({
    where: { source: AccessSource.EPISODE_PURCHASE, episode: { movie: { reviewerId } } },
    orderBy: { grantedAt: 'desc' },
    select: {
      id: true,
      paidCoins: true,
      rateVnd: true,
      grantedAt: true,
      revokedAt: true,
      revokeReason: true,
      episode: { select: { id: true, episodeNumber: true, movie: { select: { id: true, title: true } } } },
    },
  });
  const byMovie = new Map<
    string,
    { movie: { id: string; title: string }; purchases: number; coins: number; refundedCoins: number }
  >();
  for (const access of accesses) {
    const { movie } = access.episode;
    const row = byMovie.get(movie.id) ?? { movie, purchases: 0, coins: 0, refundedCoins: 0 };
    row.purchases += 1;
    row.coins += access.paidCoins;
    if (access.revokedAt) row.refundedCoins += access.paidCoins;
    byMovie.set(movie.id, row);
  }
  const entries = accesses.flatMap((access) => {
    const base = { movie: access.episode.movie, episodeNumber: access.episode.episodeNumber };
    const purchase = {
      id: access.id,
      kind: 'EPISODE_PURCHASE' as const,
      coins: access.paidCoins,
      vnd: access.paidCoins * access.rateVnd,
      at: access.grantedAt,
      note: null as string | null,
      ...base,
    };
    if (!access.revokedAt) return [purchase];
    const refund = {
      ...purchase,
      id: `${access.id}-refund`,
      kind: 'REFUND' as const,
      coins: -access.paidCoins,
      vnd: -access.paidCoins * access.rateVnd,
      at: access.revokedAt,
      note: access.revokeReason,
    };
    return [refund, purchase];
  });
  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { movies: [...byMovie.values()], entries: entries.slice(0, ACTIVITY_LIMIT) };
}
