import { ConflictException } from '@nestjs/common';
import { EpisodeStatus, Prisma, type Publication } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { isRefusal, withdrawFailedRelease } from './failed-release';

describe('isRefusal', () => {
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test' });

  it.each([
    ['a business refusal', new ConflictException('Project cancelled')],
    ['a constraint the database enforces', prismaError('P2004')],
    ['a trigger that raised', new Prisma.PrismaClientUnknownRequestError('BR-19', { clientVersion: 'test' })],
  ])('treats %s as final', (_label, error) => {
    expect(isRefusal(error)).toBe(true);
  });

  it.each([
    ['a lost connection', prismaError('P1001')],
    ['an unknown crash', new Error('socket hang up')],
  ])('leaves %s for the next sweep', (_label, error) => {
    expect(isRefusal(error)).toBe(false);
  });
});

describe('withdrawFailedRelease', () => {
  const tx = {
    publication: { updateMany: jest.fn() },
    episode: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const deps = {
    auditLog: auditLog as unknown as AuditLogService,
    notifications: notifications as unknown as NotificationService,
  };
  const publication = { id: 'pub-1', episodeId: 'ep-1' } as Publication;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.publication.updateMany.mockResolvedValue({ count: 1 });
    tx.episode.findUniqueOrThrow.mockResolvedValue({
      id: 'ep-1',
      movieId: 'm1',
      episodeNumber: 3,
      movie: { reviewerId: 'rev-1', title: 'Phim' },
    });
  });

  it('withdraws the schedule, hands the episode back and tells the Reviewer', async () => {
    await withdrawFailedRelease(tx as unknown as PrismaTx, publication, 'BR-19 gate', deps);

    expect(tx.publication.updateMany).toHaveBeenCalledWith({
      where: { id: 'pub-1', publishedAt: null, unpublishedAt: null },
      data: expect.objectContaining({
        unpublishReason: 'MANUAL',
        unpublishNote: 'Scheduled release failed: BR-19 gate',
      }),
    });
    expect(tx.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'ep-1', status: EpisodeStatus.SCHEDULED },
      data: { status: EpisodeStatus.COMPLIANCE_PASSED },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      ['rev-1'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.EPISODE_RELEASE_FAILED }),
      tx,
    );
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'pub-1' }), tx);
  });

  it('leaves a release that went out or was withdrawn meanwhile alone', async () => {
    tx.publication.updateMany.mockResolvedValue({ count: 0 });

    await withdrawFailedRelease(tx as unknown as PrismaTx, publication, 'late', deps);

    expect(tx.episode.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
