import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { CatalogService, episodeView } from './catalog.service';
import { REVISION_NOTICE } from './episode-visibility';

const base = {
  id: 'e1',
  movieId: 'm1',
  seasonId: 's1',
  episodeNumber: 3,
  title: 'Tập 3',
  synopsis: null,
  thumbnailUrl: null,
  status: 'PUBLISHED',
  targetDurationSeconds: 900,
  dueDate: null,
  approvedMediaAssetId: 'a1',
  coinPrice: 12,
  revisionStartedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  season: { seasonNumber: 1, title: null },
  approvedMediaAsset: {
    durationSeconds: 600,
    qualities: ['360p', '720p'],
    aiContentLabel: { labelType: 'AI_GENERATED', labelText: 'Phim AI', displayLocation: 'TOP_RIGHT' },
  },
  publications: [{ publishedAt: new Date('2026-10-01') }],
} as unknown as Parameters<typeof episodeView>[0];

describe('Catalog episode view', () => {
  it('marks the first episodes of the movie as free starters (BR-03)', () => {
    expect(episodeView(base, 3).isFreeStarter).toBe(true);
    expect(episodeView(base, 2).isFreeStarter).toBe(false);
  });

  it('shows a released episode with its label and length', () => {
    expect(episodeView(base, 2)).toMatchObject({
      availability: 'AVAILABLE',
      notice: null,
      durationSeconds: 600,
      aiLabel: { labelType: 'AI_GENERATED' },
    });
  });

  it('shows an episode under revision with the notice, without the old version (BR-56)', () => {
    const view = episodeView({ ...base, revisionStartedAt: new Date() }, 2);
    expect(view).toMatchObject({
      availability: 'UNDER_REVISION',
      notice: REVISION_NOTICE,
      durationSeconds: null,
      qualities: [],
      aiLabel: null,
    });
  });
});

describe('Catalog ranking', () => {
  const movie = (id: string, views: number[]) => ({
    id,
    title: id,
    genres: [],
    episodes: views.map((count) => ({ _count: { views: count } })),
  });
  const prisma = { movie: { findMany: jest.fn() } };
  const catalog = new CatalogService(prisma as unknown as PrismaService, {} as PlatformSettingService);

  it('ranks listed movies by the plays of all their episodes, most first', async () => {
    // findMany hands them newest first; a tie keeps that order.
    prisma.movie.findMany.mockResolvedValue([movie('new', [1]), movie('hit', [40, 25]), movie('old', [0, 1])]);

    const ranked = await catalog.ranking();

    expect(ranked.map((m) => [m.id, m.viewCount])).toEqual([
      ['hit', 65],
      ['new', 1],
      ['old', 1],
    ]);
    expect(prisma.movie.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
  });

  it('keeps only the top of the list', async () => {
    prisma.movie.findMany.mockResolvedValue([movie('a', [3]), movie('b', [2]), movie('c', [1])]);
    expect((await catalog.ranking(2)).map((m) => m.id)).toEqual(['a', 'b']);
  });
});
