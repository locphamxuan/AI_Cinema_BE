import { episodeView, REVISION_NOTICE } from './catalog.service';

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
