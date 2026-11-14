import { ProjectStatus } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { ContentReviewService } from 'src/modules/production/content-review/content-review.service';
import { EpisodeRevisionService } from './episode-revision.service';

const PROJECT = { id: 'p1', status: ProjectStatus.COMPLETED };
const ASSET = {
  id: 'm1',
  episodeId: 'e1',
  episode: { id: 'e1', movieId: 'p1', movie: { id: 'p1', title: 'Phim', project: PROJECT } },
};
const PUBLICATION = { id: 'pub1', episodeId: 'e1', mediaAssetId: 'm1' };

describe('EpisodeRevisionService', () => {
  const tx = {
    mediaAsset: { findUniqueOrThrow: jest.fn() },
    episode: { update: jest.fn() },
    movieProject: { updateMany: jest.fn() },
  };
  const reviews = { requestChanges: jest.fn(), announce: jest.fn() };
  const auditLog = { record: jest.fn() };
  const service = new EpisodeRevisionService(
    reviews as unknown as ContentReviewService,
    auditLog as unknown as AuditLogService,
  );
  const sendBack = () => service.sendBack(tx as unknown as PrismaTx, PUBLICATION as never, 'rev', 'Sai phụ đề');

  beforeEach(() => {
    jest.clearAllMocks();
    tx.mediaAsset.findUniqueOrThrow.mockResolvedValue(ASSET);
    tx.movieProject.updateMany.mockResolvedValue({ count: 1 });
    reviews.requestChanges.mockResolvedValue('mail-1');
  });

  it('asks the studio for a fix, flags the episode under maintenance and reopens a completed movie', async () => {
    await expect(sendBack()).resolves.toBe('mail-1');
    expect(reviews.requestChanges).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 'm1', episode: expect.objectContaining({ project: PROJECT }) as unknown }),
      'rev',
      'Taken down to be fixed: Sai phụ đề',
    );
    expect(tx.episode.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { revisionStartedAt: expect.any(Date) as unknown },
    });
    expect(tx.movieProject.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: ProjectStatus.COMPLETED },
      data: { status: ProjectStatus.UNDER_REVISION },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.PROJECT_UNDER_REVISION,
        payload: { episodeId: 'e1', reason: 'Sai phụ đề' },
      }),
      tx,
    );
  });

  it('records nothing more when the movie was not completed', async () => {
    tx.movieProject.updateMany.mockResolvedValue({ count: 0 });
    await sendBack();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('hands the queued mail to the review service once committed', async () => {
    reviews.announce.mockResolvedValue(undefined);
    await service.announce('mail-1');
    expect(reviews.announce).toHaveBeenCalledWith('mail-1');
  });
});
