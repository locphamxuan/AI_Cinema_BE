import type { Prisma } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { blendPopularity } from 'src/modules/catalog/popularity';

/**
 * An episode a recommendation may lead to: published, not taken down for a revision, and its approved film
 * ingested into our own storage (Cloudflare R2 behind the CDN) and ready to stream. An external HLS link or a
 * film still transcoding never makes its movie a candidate.
 */
export const R2_PLAYABLE_EPISODE = {
  status: 'PUBLISHED',
  revisionStartedAt: null,
  approvedMediaAsset: { is: { ingestStatus: 'READY', isSelfHosted: true, streamUrl: { not: null } } },
} satisfies Prisma.EpisodeWhereInput;

/** Movies a recommendation may name: at least one episode playable from R2. */
export const LISTED = { episodes: { some: R2_PLAYABLE_EPISODE } } satisfies Prisma.MovieWhereInput;

export type CandidateMovie = {
  id: string;
  title: string;
  ageRating: string | null;
  posterUrl: string | null;
  country: string | null;
  releaseYear: number | null;
  genres: { genre: { name: string } }[];
};

/** Newest first, so equal scores keep a stable order. */
export function loadCandidates(prisma: PrismaService): Promise<CandidateMovie[]> {
  return prisma.movie.findMany({
    where: LISTED,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      ageRating: true,
      posterUrl: true,
      country: true,
      releaseYear: true,
      genres: { select: { genre: { select: { name: true } } } },
    },
  });
}

/** Watch time over the R2-playable episodes and hearts, each scaled to the top movie (0..1). */
export async function loadPopularity(prisma: PrismaService): Promise<Map<string, number>> {
  const [rows, likes] = await Promise.all([
    prisma.$queryRaw<{ movieId: string; total: bigint }[]>`
      SELECT e."movie_id" AS "movieId", COALESCE(SUM(s."total_watched_seconds"), 0) AS total
      FROM "episodes" e
      JOIN "media_assets" a ON a."id" = e."approved_media_asset_id"
      LEFT JOIN "episode_watch_stats" s ON s."episode_id" = e."id"
      WHERE e."status" = 'PUBLISHED'
        AND e."revision_started_at" IS NULL
        AND a."ingest_status" = 'READY'
        AND a."is_self_hosted" = true
        AND a."stream_url" IS NOT NULL
      GROUP BY e."movie_id"
    `,
    prisma.movieLike.groupBy({ by: ['movieId'], _count: { _all: true } }),
  ]);
  const likeMap = new Map(likes.map((l) => [l.movieId, l._count._all]));
  return blendPopularity(
    rows.map((r) => ({ id: r.movieId, views: Number(r.total), likes: likeMap.get(r.movieId) ?? 0 })),
  );
}
