import { OverdueEpisodesJob } from './overdue-episodes.job';

const EPISODE = {
  id: 'e1',
  movieId: 'p1',
  episodeNumber: 3,
  dueDate: new Date('2026-11-01T00:00:00Z'),
  movie: { title: 'Phim A', project: { reviewerId: 'rev', studioId: 's1' } },
};

function setup(alreadyFlagged = 0) {
  const prisma = {
    episode: { findMany: jest.fn().mockResolvedValue([EPISODE]) },
    notification: { count: jest.fn().mockResolvedValue(alreadyFlagged) },
  };
  const notifications = {
    notify: jest.fn(),
    studioAccountIds: jest.fn().mockResolvedValue(['st1']),
    adminIds: jest.fn().mockResolvedValue(['admin']),
  };
  const job = new OverdueEpisodesJob(prisma as never, {} as never, notifications as never, {} as never);
  return { job, notifications };
}

describe('OverdueEpisodesJob (BR-38, audit 2026-11-12)', () => {
  it('flags a late episode to its studio, its Reviewer and the Admins', async () => {
    const { job, notifications } = setup();
    await expect(job.sweep(new Date('2026-11-12T03:00:00Z'))).resolves.toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      ['st1', 'rev', 'admin'],
      expect.objectContaining({ payload: { projectId: 'p1', episodeId: 'e1' } }),
    );
  });

  it('flags an episode only once', async () => {
    const { job, notifications } = setup(1);
    await expect(job.sweep(new Date('2026-11-12T03:00:00Z'))).resolves.toBe(0);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
