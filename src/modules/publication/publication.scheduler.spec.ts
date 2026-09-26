import type { ConfigService } from '@nestjs/config';
import type { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { PublicationScheduler } from './publication.scheduler';
import type { PublicationService } from './publication.service';

describe('PublicationScheduler', () => {
  const findDue = jest.fn();
  const goLive = jest.fn();
  const record = jest.fn();
  const scheduler = new PublicationScheduler(
    { findDue, goLive } as unknown as PublicationService,
    { record } as unknown as AuditLogService,
    { get: () => undefined } as unknown as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('publishes every due episode and records it as a system event', async () => {
    findDue.mockResolvedValue([{ id: 'pub-1' }, { id: 'pub-2' }]);
    goLive.mockResolvedValue({ id: 'published' });

    await expect(scheduler.sweep()).resolves.toBe(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EPISODE_PUBLISHED', entityId: 'pub-1', actorId: null }),
    );
  });

  it('skips a publication someone else put live first', async () => {
    findDue.mockResolvedValue([{ id: 'pub-1' }]);
    goLive.mockResolvedValue(null);

    await expect(scheduler.sweep()).resolves.toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('never starts a timer under Jest', () => {
    scheduler.onApplicationBootstrap();
    expect((scheduler as unknown as { timer: unknown }).timer).toBeNull();
  });
});
