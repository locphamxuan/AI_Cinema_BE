import { ContentReviewService, type ReviewedAsset } from './content-review.service';

function setup() {
  const tx = {
    episode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contentReview: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
  };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    studioAccountIds: jest.fn().mockResolvedValue(['studio-user']),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ContentReviewService({} as never, {} as never, auditLog as never, notifications as never);
  const asset = {
    id: 'a1',
    version: 2,
    episode: {
      id: 'e1',
      movieId: 'p1',
      episodeNumber: 2,
      assignedCreatorId: null,
      movie: { title: 'Phim A' },
      project: { creatorId: 'lead', studioId: 's1' },
    },
  } as unknown as ReviewedAsset;
  return { service, tx, notifications, asset };
}

describe('ContentReviewService.requestChanges (BR-18, MF-1 §5)', () => {
  it("tells the studio's accounts directly, not the Creators", async () => {
    const { service, tx, notifications, asset } = setup();
    await service.requestChanges(tx as never, asset, 'rev', 'Sửa cảnh 3');
    expect(notifications.studioAccountIds).toHaveBeenCalledWith('s1', tx);
    expect(notifications.notify.mock.calls.map((call: unknown[]) => call[0])).toEqual([['studio-user']]);
  });

  it('clears the Final Film confirmation with the approved version', async () => {
    const { service, tx, asset } = setup();
    await service.requestChanges(tx as never, asset, 'rev', 'Sửa cảnh 3');
    expect(tx.episode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedMediaAssetId: null, finalConfirmedAt: null, finalConfirmedById: null }),
      }),
    );
  });
});
