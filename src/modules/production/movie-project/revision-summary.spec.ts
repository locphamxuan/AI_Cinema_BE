import { revisionSummary } from './revision-summary';

const ep = (episodeNumber: number, fixing = false) => ({
  episodeNumber,
  revisionStartedAt: fixing ? new Date('2026-10-02') : null,
});

describe('Episodes being fixed (BR-56)', () => {
  it('counts them and groups them by season, leaving out seasons with none', () => {
    const summary = revisionSummary([
      { seasonNumber: 1, episodes: [ep(1), ep(2, true), ep(3, true)] },
      { seasonNumber: 2, episodes: [ep(4)] },
      { seasonNumber: 3, episodes: [ep(5, true)] },
    ]);
    expect(summary).toEqual({
      episodeCount: 3,
      bySeason: [
        { seasonNumber: 1, episodeNumbers: [2, 3] },
        { seasonNumber: 3, episodeNumbers: [5] },
      ],
    });
  });

  it('is empty when nothing is being fixed', () => {
    expect(revisionSummary([{ seasonNumber: 1, episodes: [ep(1), ep(2)] }])).toEqual({ episodeCount: 0, bySeason: [] });
  });
});
