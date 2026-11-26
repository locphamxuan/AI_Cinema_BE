import { ContentReviewDecision } from '@prisma/client';
import { ContentReviewService, durationCheck } from './content-review.service';

describe('Episode length check (BR-31)', () => {
  it('warns only beyond 20% of the target, in either direction', () => {
    expect(durationCheck(600, 700)).toMatchObject({ deviationSeconds: 100, warning: false });
    expect(durationCheck(600, 721)).toMatchObject({ deviationSeconds: 121, warning: true });
    expect(durationCheck(600, 470)).toMatchObject({ deviationSeconds: -130, warning: true });
  });

  it('cannot judge a version whose length is unknown', () => {
    expect(durationCheck(600, null)).toEqual({
      targetSeconds: 600,
      actualSeconds: null,
      deviationSeconds: null,
      warning: false,
    });
  });
});

describe('ContentReviewService.review: only the version under review is judged', () => {
  const asset = (status: string, id = 'a1') => ({
    id,
    version: 1,
    ingestStatus: 'READY',
    studioHandoffId: null,
    episodeId: 'e1',
    episode: {
      id: 'e1',
      status,
      movieId: 'p1',
      episodeNumber: 1,
      approvedMediaAssetId: null,
      movie: { title: 'Phim' },
      project: { status: 'IN_PRODUCTION', studioId: 's1', reviewerId: 'rev' },
    },
  });

  function setup(latestId: string) {
    const tx = {
      episode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contentReview: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
    };
    const prisma = {
      mediaAsset: { findFirst: jest.fn().mockResolvedValue({ id: latestId }) },
      $transaction: jest.fn((work: (db: unknown) => Promise<unknown>) => work(tx)),
    };
    const access = { mediaAsset: jest.fn().mockResolvedValue(asset('IN_REVIEW')) };
    const notifications = { notify: jest.fn(), studioAccountIds: jest.fn().mockResolvedValue([]) };
    const mails = { queue: jest.fn().mockResolvedValue(null), dispatch: jest.fn() };
    const service = new ContentReviewService(
      prisma as never,
      access as never,
      { record: jest.fn() } as never,
      notifications as never,
      mails as never,
    );
    jest.spyOn(service, 'sheet').mockResolvedValue({} as never);
    return { service, tx, prisma };
  }

  it('refuses to approve or send back an older READY version while a newer delivery is in review', async () => {
    const { service, tx } = setup('a2');
    for (const decision of [ContentReviewDecision.APPROVED, ContentReviewDecision.CHANGES_REQUESTED]) {
      await expect(
        service.review('a1', { decision, comments: 'Sửa cảnh mở đầu' }, { id: 'rev' } as never),
      ).rejects.toMatchObject({ response: { details: { reason: 'NOT_CURRENT_VERSION' } } });
    }
    expect(tx.episode.updateMany).not.toHaveBeenCalled();
  });

  it('approves the newest delivery', async () => {
    const { service, tx, prisma } = setup('a1');
    await service.review('a1', { decision: ContentReviewDecision.APPROVED }, { id: 'rev' } as never);
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { episodeId: 'e1' }, orderBy: { version: 'desc' } }),
    );
    expect(tx.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'IN_REVIEW' },
      data: { status: 'APPROVED', approvedMediaAssetId: 'a1' },
    });
  });
});
