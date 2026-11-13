import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, UnpublishMode, UnpublishReason, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { EntitlementService } from 'src/modules/episode-access/entitlement/entitlement.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { ProjectLifecycleService } from 'src/modules/production/movie-project/project-lifecycle.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { EpisodeRevisionService } from './episode-revision.service';
import { CdnPurgeService } from 'src/infrastructure/cdn/cdn-purge.service';
import type { RoomTerminationService } from 'src/modules/playback/watch-room/room-termination.service';
import { PublicationService } from './publication.service';

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const PROJECT = { status: ProjectStatus.IN_PRODUCTION, reviewerId: 'rev', creatorId: 'cre' };
const MOVIE = { title: 'Phim', synopsis: 'Tóm tắt', ageRating: 'T13', project: PROJECT };

const episode = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  movieId: 'p1',
  episodeNumber: 1,
  status: EpisodeStatus.COMPLIANCE_PASSED,
  approvedMediaAssetId: 'm1',
  finalConfirmedAt: new Date('2026-11-01T00:00:00Z'),
  coinPrice: 10,
  revisionStartedAt: null as Date | null,
  movie: MOVIE,
  project: PROJECT,
  ...overrides,
});

const publication = (overrides: Record<string, unknown> = {}) => ({
  id: 'pub1',
  episodeId: 'e1',
  mediaAssetId: 'm1',
  scheduledAt: null,
  publishedAt: null as Date | null,
  unpublishedAt: null as Date | null,
  ...overrides,
});

describe('PublicationService', () => {
  const db = {
    publication: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    episode: { findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    aiContentLabel: { count: jest.fn() },
    complianceCheck: { count: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { episode: jest.fn() };
  const lifecycle = { completeIfAllPublished: jest.fn() };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const revisions = { sendBack: jest.fn(), announce: jest.fn() };
  const entitlements = { refundEpisodeRemoval: jest.fn() };
  const settings = { get: jest.fn() };
  const cdn = { purgeAsset: jest.fn().mockResolvedValue({ purged: true }) };
  const roomTermination = { episodeTakenDown: jest.fn() };
  const service = new PublicationService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    lifecycle as unknown as ProjectLifecycleService,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
    revisions as unknown as EpisodeRevisionService,
    entitlements as unknown as EntitlementService,
    settings as unknown as PlatformSettingService,
    cdn as unknown as CdnPurgeService,
    roomTermination as unknown as RoomTerminationService,
  );
  const actions = () => auditLog.record.mock.calls.map(([event]) => (event as { action: string }).action);

  beforeEach(() => {
    jest.clearAllMocks();
    access.episode.mockResolvedValue(episode());
    db.aiContentLabel.count.mockResolvedValue(1);
    db.complianceCheck.count.mockResolvedValue(4);
    db.publication.findFirst.mockResolvedValue(null);
    db.publication.create.mockResolvedValue(publication());
    db.publication.updateMany.mockResolvedValue({ count: 1 });
    db.publication.findMany.mockResolvedValue([]);
    db.episode.updateMany.mockResolvedValue({ count: 1 });
    db.episode.findUniqueOrThrow.mockResolvedValue(episode());
    settings.get.mockResolvedValue({ refundOnRemoval: true });
    revisions.sendBack.mockResolvedValue('mail-1');
  });

  describe('missingForRelease (BR-19)', () => {
    it('is empty for an episode with everything in place', async () => {
      await expect(service.missingForRelease(episode() as never)).resolves.toEqual([]);
    });

    it('lists every gap, and skips the media checks when no version is approved', async () => {
      const bare = episode({
        approvedMediaAssetId: null,
        finalConfirmedAt: null,
        coinPrice: null,
        movie: { ...MOVIE, synopsis: '  ', ageRating: null },
      });
      await expect(service.missingForRelease(bare as never)).resolves.toEqual([
        'an approved media version',
        'the Final Film confirmation of the Reviewer',
        'a Coin price (BR-29)',
        'the movie synopsis',
        'the movie age rating',
      ]);
      expect(db.aiContentLabel.count).not.toHaveBeenCalled();
    });

    it('asks for the AI label and all four compliance items', async () => {
      db.aiContentLabel.count.mockResolvedValue(0);
      db.complianceCheck.count.mockResolvedValue(3);
      await expect(service.missingForRelease(episode() as never)).resolves.toEqual([
        'an AI label (BR-40)',
        'a passed compliance check (BR-42)',
      ]);
    });

    it('does not ask a re-release for the Final Film confirmation again', async () => {
      const removed = episode({ status: EpisodeStatus.UNPUBLISHED, finalConfirmedAt: null });
      await expect(service.missingForRelease(removed as never)).resolves.toEqual([]);
    });
  });

  describe('publish', () => {
    it('releases now: publishes the episode, tells the team and may complete the project', async () => {
      await service.publish('e1', {}, ADMIN);
      expect(db.publication.create).toHaveBeenCalledWith({
        data: { episodeId: 'e1', mediaAssetId: 'm1', scheduledAt: null, publishedById: 'admin' },
      });
      expect(db.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', status: EpisodeStatus.COMPLIANCE_PASSED },
        data: { status: EpisodeStatus.PUBLISHED },
      });
      expect(actions()).toEqual([CONTENT_EVENT.EPISODE_PUBLISHED]);
      expect(notifications.notify).toHaveBeenCalledWith(
        ['rev', 'cre'],
        expect.objectContaining({ type: NOTIFICATION_TYPE.EPISODE_PUBLISHED }),
        db,
      );
      expect(lifecycle.completeIfAllPublished).toHaveBeenCalledWith('p1', db);
    });

    it('clears the maintenance flag once a fixed version is back out (BR-56)', async () => {
      db.episode.findUniqueOrThrow.mockResolvedValue(episode({ revisionStartedAt: new Date() }));
      await service.publish('e1', {}, ADMIN);
      expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { revisionStartedAt: null } });
    });

    it('schedules a future release, or moves the pending one', async () => {
      const at = new Date(Date.now() + 3_600_000).toISOString();
      await service.publish('e1', { scheduledAt: at }, ADMIN);
      expect(db.episode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: EpisodeStatus.SCHEDULED } }),
      );
      expect(actions()).toEqual([CONTENT_EVENT.EPISODE_SCHEDULED]);
      expect(lifecycle.completeIfAllPublished).not.toHaveBeenCalled();

      jest.clearAllMocks();
      db.publication.findFirst.mockResolvedValue(publication({ id: 'pending' }));
      db.publication.update.mockResolvedValue(publication({ id: 'pending' }));
      await service.publish('e1', { scheduledAt: at }, ADMIN);
      expect(db.publication.update).toHaveBeenCalledWith({
        where: { id: 'pending' },
        data: { scheduledAt: new Date(at), publishedById: 'admin' },
      });
      expect(db.publication.create).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ rescheduled: true }) as unknown }),
        db,
      );
    });

    it('refuses a past schedule, a blocked episode and a project that is not releasing', async () => {
      await expect(service.publish('e1', { scheduledAt: '2000-01-01T00:00:00Z' }, ADMIN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      db.aiContentLabel.count.mockResolvedValue(0);
      await expect(service.publish('e1', {}, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      access.episode.mockResolvedValue(episode({ project: { ...PROJECT, status: ProjectStatus.ASSIGNED } }));
      await expect(service.publish('e1', {}, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('unpublish', () => {
    const dto = { reason: UnpublishReason.COMPLIANCE_ISSUE, note: ' Sai phụ đề ' };

    it('sends a live episode back to be fixed and announces the mail after commit (BR-56)', async () => {
      const live = publication({ publishedAt: new Date() });
      db.publication.findUnique.mockResolvedValue(live);
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.PUBLISHED }));
      await service.unpublish('pub1', { ...dto, mode: UnpublishMode.REVISION }, ADMIN);
      expect(revisions.sendBack).toHaveBeenCalledWith(db, live, 'admin', 'Sai phụ đề');
      expect(db.episode.updateMany).not.toHaveBeenCalled();
      expect(entitlements.refundEpisodeRemoval).not.toHaveBeenCalled();
      expect(revisions.announce).toHaveBeenCalledWith('mail-1');
    });

    it('takes a live episode down for good and refunds the unlocks (BR-52)', async () => {
      db.publication.findUnique.mockResolvedValue(publication({ publishedAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.PUBLISHED }));
      await service.unpublish('pub1', { ...dto, mode: UnpublishMode.REMOVAL }, ADMIN);
      expect(db.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', status: EpisodeStatus.PUBLISHED },
        data: { status: EpisodeStatus.UNPUBLISHED },
      });
      expect(entitlements.refundEpisodeRemoval).toHaveBeenCalledWith(db, 'e1', UnpublishReason.COMPLIANCE_ISSUE);
      expect(revisions.announce).toHaveBeenCalledWith(null);
      // Edge 1.4 (BR-69): every watch room on the episode is terminated after the commit.
      expect(roomTermination.episodeTakenDown).toHaveBeenCalledWith('e1');
    });

    it('skips the refund when the platform turned it off', async () => {
      settings.get.mockResolvedValue({ refundOnRemoval: false });
      db.publication.findUnique.mockResolvedValue(publication({ publishedAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.PUBLISHED }));
      await service.unpublish('pub1', { ...dto, mode: UnpublishMode.REMOVAL }, ADMIN);
      expect(entitlements.refundEpisodeRemoval).not.toHaveBeenCalled();
    });

    it('purges the asset from the CDN edge once a live episode is down', async () => {
      db.publication.findUnique.mockResolvedValue(publication({ publishedAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.PUBLISHED }));
      await service.unpublish('pub1', { ...dto, mode: UnpublishMode.REMOVAL }, ADMIN);
      expect(cdn.purgeAsset).toHaveBeenCalledWith('m1');
    });

    it('does not purge a release that never went live: nothing was ever cached', async () => {
      db.publication.findUnique.mockResolvedValue(publication({ scheduledAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.SCHEDULED }));
      await service.unpublish('pub1', dto, ADMIN);
      expect(cdn.purgeAsset).not.toHaveBeenCalled();
    });

    it('cancels a scheduled release without asking for a mode', async () => {
      db.publication.findUnique.mockResolvedValue(publication({ scheduledAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.SCHEDULED }));
      await service.unpublish('pub1', dto, ADMIN);
      expect(db.episode.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', status: EpisodeStatus.SCHEDULED },
        data: { status: EpisodeStatus.COMPLIANCE_PASSED },
      });
      expect(roomTermination.episodeTakenDown).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: CONTENT_EVENT.EPISODE_UNPUBLISHED,
          payload: expect.objectContaining({ mode: null, cancelledSchedule: true }) as unknown,
        }),
        db,
      );
    });

    it('refuses an unknown, an already taken-down or a mode-less live release', async () => {
      db.publication.findUnique.mockResolvedValue(null);
      await expect(service.unpublish('x', dto, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
      db.publication.findUnique.mockResolvedValue(publication({ unpublishedAt: new Date() }));
      await expect(service.unpublish('pub1', dto, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      db.publication.findUnique.mockResolvedValue(publication({ publishedAt: new Date() }));
      access.episode.mockResolvedValue(episode({ status: EpisodeStatus.PUBLISHED }));
      await expect(service.unpublish('pub1', dto, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('publishDue', () => {
    it('releases the due schedules and withdraws one the rules refuse', async () => {
      db.publication.findMany.mockResolvedValue([publication({ id: 'ok' }), publication({ id: 'refused' })]);
      db.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episode())
        .mockResolvedValueOnce(
          episode({ movie: { ...MOVIE, project: { ...PROJECT, status: ProjectStatus.CANCELLED } } }),
        );
      await expect(service.publishDue(new Date())).resolves.toBe(1);
      // The refused release is withdrawn: its schedule ends with a note and the episode goes back.
      expect(db.publication.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'refused', publishedAt: null, unpublishedAt: null },
        data: expect.objectContaining({ unpublishReason: UnpublishReason.MANUAL }),
      });
    });

    it('leaves a release due when the database is unreachable', async () => {
      db.publication.findMany.mockResolvedValue([publication()]);
      prisma.$transaction.mockRejectedValueOnce(new Error('connection reset'));
      await expect(service.publishDue(new Date())).resolves.toBe(0);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
