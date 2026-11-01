import { ContentReviewService, type ReviewedAsset } from './content-review.service';

function setup(assignedCreatorId: string | null) {
  const tx = {
    episode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contentReview: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ContentReviewService({} as never, {} as never, auditLog as never, notifications as never);
  const asset = {
    id: 'a1',
    version: 2,
    episode: {
      id: 'e1',
      movieId: 'p1',
      episodeNumber: 2,
      assignedCreatorId,
      movie: { title: 'Phim A' },
      project: { creatorId: 'lead' },
    },
  } as unknown as ReviewedAsset;
  return { service, tx, notifications, asset };
}

const recipients = (notify: jest.Mock) => notify.mock.calls.map((call: unknown[]) => call[0]);

describe('ContentReviewService.requestChanges (BR-18, BR-67)', () => {
  it('tells the co-Creator holding the episode as well as the lead', async () => {
    const { service, tx, notifications, asset } = setup('helper');
    await service.requestChanges(tx as never, asset, 'rev', 'Sửa cảnh 3');
    expect(recipients(notifications.notify)).toEqual([['helper'], ['lead']]);
  });

  it('tells the lead alone when the lead holds the episode', async () => {
    for (const holder of [null, 'lead']) {
      const { service, tx, notifications, asset } = setup(holder);
      await service.requestChanges(tx as never, asset, 'rev', 'Sửa cảnh 3');
      expect(recipients(notifications.notify)).toEqual([['lead']]);
    }
  });
});
