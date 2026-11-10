import { ConflictException, NotFoundException } from '@nestjs/common';
import { PriceAlertStatus, ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { PricingService } from './pricing.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const EPISODE = {
  id: 'e1',
  episodeNumber: 3,
  movieId: 'p1',
  coinPrice: 10,
  movie: { title: 'Phim' },
  project: { status: ProjectStatus.IN_PRODUCTION, reviewerId: 'rev' },
};

describe('PricingService', () => {
  const db = {
    episode: { update: jest.fn() },
    priceAlert: { updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { episode: jest.fn() };
  const settings = { get: jest.fn() };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn() };
  const service = new PricingService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    settings as unknown as PlatformSettingService,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );

  const alertRow = (status: PriceAlertStatus) => ({
    id: 'a1',
    episodeId: 'e1',
    status,
    episode: {
      episodeNumber: 3,
      movie: { id: 'p1', title: 'Phim', project: { reviewerId: 'rev' } },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    access.episode.mockResolvedValue(EPISODE);
    settings.get.mockResolvedValue({ episodeCoinPriceMin: 5, episodeCoinPriceMax: 50 });
    notifications.adminIds.mockResolvedValue(['admin']);
    db.priceAlert.create.mockResolvedValue({ id: 'a1' });
    db.priceAlert.updateMany.mockResolvedValue({ count: 1 });
    db.priceAlert.findUniqueOrThrow.mockResolvedValue({ id: 'a1' });
  });

  it('saves a price inside the range, settles older alerts and raises none', async () => {
    await expect(service.setPrice('e1', 20, REVIEWER)).resolves.toEqual({
      episodeId: 'e1',
      coinPrice: 20,
      inRange: true,
      rangeMin: 5,
      rangeMax: 50,
      alert: null,
    });
    expect(access.episode).toHaveBeenCalledWith('e1', REVIEWER, 'reviewer');
    expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { coinPrice: 20 } });
    expect(db.priceAlert.updateMany).toHaveBeenCalledWith({
      where: { episodeId: 'e1', status: { in: [PriceAlertStatus.OPEN, PriceAlertStatus.CHANGE_REQUESTED] } },
      data: expect.objectContaining({ status: PriceAlertStatus.RESOLVED }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.EPISODE_PRICED,
        payload: { previousPrice: 10, coinPrice: 20, rangeMin: 5, rangeMax: 50 },
      }),
      db,
    );
    expect(db.priceAlert.create).not.toHaveBeenCalled();
  });

  it('keeps an out-of-range price but raises an alert for the Admins (BR-47)', async () => {
    const result = await service.setPrice('e1', 80, REVIEWER);
    expect(result).toMatchObject({ inRange: false, alert: { id: 'a1' } });
    expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { coinPrice: 80 } });
    expect(db.priceAlert.create).toHaveBeenCalledWith({
      data: { episodeId: 'e1', coinPrice: 80, rangeMin: 5, rangeMax: 50, setById: 'rev' },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.PRICE_OUT_OF_RANGE, entityId: 'a1' }),
      db,
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      ['admin'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.PRICE_OUT_OF_RANGE }),
      db,
    );
  });

  it('accepts the bounds themselves as in range', async () => {
    await expect(service.setPrice('e1', 5, REVIEWER)).resolves.toMatchObject({ inRange: true });
    await expect(service.setPrice('e1', 50, REVIEWER)).resolves.toMatchObject({ inRange: true });
  });

  it('refuses to price an episode of a cancelled project', async () => {
    access.episode.mockResolvedValue({ ...EPISODE, project: { ...EPISODE.project, status: ProjectStatus.CANCELLED } });
    await expect(service.setPrice('e1', 20, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
    expect(db.episode.update).not.toHaveBeenCalled();
  });

  it("asks the project's Reviewer to reconsider an open alert", async () => {
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.OPEN));
    await expect(service.requestChange('a1', '  Giá quá cao ', ADMIN)).resolves.toEqual({ id: 'a1' });
    expect(db.priceAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: PriceAlertStatus.OPEN },
      data: expect.objectContaining({
        status: PriceAlertStatus.CHANGE_REQUESTED,
        adminNote: 'Giá quá cao',
        handledById: 'admin',
      }),
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      ['rev'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.PRICE_CHANGE_REQUEST, body: 'Giá quá cao' }),
      db,
    );
  });

  it('only asks once, and notices an alert that changed meanwhile', async () => {
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.CHANGE_REQUESTED));
    await expect(service.requestChange('a1', 'x', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.OPEN));
    db.priceAlert.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.requestChange('a1', 'x', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lets the Admin accept an unresolved alert as it is', async () => {
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.CHANGE_REQUESTED));
    await expect(service.resolve('a1', ADMIN)).resolves.toEqual({ id: 'a1' });
    expect(db.priceAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: { in: [PriceAlertStatus.OPEN, PriceAlertStatus.CHANGE_REQUESTED] } },
      data: expect.objectContaining({ status: PriceAlertStatus.RESOLVED, handledById: 'admin' }),
    });
  });

  it('refuses a resolved, a racing or an unknown alert', async () => {
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.RESOLVED));
    await expect(service.resolve('a1', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    db.priceAlert.findUnique.mockResolvedValue(alertRow(PriceAlertStatus.OPEN));
    db.priceAlert.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resolve('a1', ADMIN)).rejects.toBeInstanceOf(ConflictException);
    db.priceAlert.findUnique.mockResolvedValue(null);
    await expect(service.resolve('a9', ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
