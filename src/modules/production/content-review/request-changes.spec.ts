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
  const mails = { queue: jest.fn().mockResolvedValue('m1') };
  const service = new ContentReviewService(
    {} as never,
    {} as never,
    auditLog as never,
    notifications as never,
    mails as never,
  );
  const asset = {
    id: 'a1',
    version: 2,
    episode: {
      id: 'e1',
      movieId: 'p1',
      episodeNumber: 2,
      assignedCreatorId: null,
      movie: { title: 'Phim A' },
      project: { creatorId: 'lead', reviewerId: 'reviewer', studioId: 's1' },
    },
  } as unknown as ReviewedAsset;
  return { service, tx, notifications, mails, asset };
}

describe('ContentReviewService.requestChanges (BR-18, MF-1 §5)', () => {
  it("tells the studio's accounts directly, not the Creators", async () => {
    const { service, tx, notifications, asset } = setup();
    await service.requestChanges(tx as never, asset, 'rev', 'Sửa cảnh 3');
    expect(notifications.studioAccountIds).toHaveBeenCalledWith('s1', tx);
    expect(notifications.notify.mock.calls.map((call: unknown[]) => call[0])).toEqual([['studio-user']]);
  });

  it('emails the studio with the Reviewer in charge as its contact, even when an Admin took the episode down', async () => {
    const { service, tx, mails, asset } = setup();
    await expect(service.requestChanges(tx as never, asset, 'admin', 'Sửa cảnh 3')).resolves.toBe('m1');
    expect(mails.queue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        studioId: 's1',
        senderId: 'reviewer',
        lines: expect.arrayContaining(['Sửa cảnh 3']) as string[],
        portalPath: '/projects/p1/episodes/e1',
      }),
    );
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
