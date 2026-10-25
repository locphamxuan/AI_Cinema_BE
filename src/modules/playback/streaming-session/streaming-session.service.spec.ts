import { BadRequestException } from '@nestjs/common';
import { PlaybackAccessType, StreamingSessionStatus } from '@prisma/client';
import { sessionHarness } from './streaming-session.test-harness';
import { MAX_WATCH_CREDIT_SECONDS, PROGRESS_WRITE_INTERVAL_MS } from './watch-pacing';

describe('StreamingSessionService.create', () => {
  const { service, prisma, tx, access, devices, progress, ads, audit, runningPlan, reset } = sessionHarness();
  beforeEach(reset);

  it('opens a member session after access and device checks (step 11)', async () => {
    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    expect(access.verify).toHaveBeenCalledWith('ep-1', 'u-1', runningPlan);
    expect(devices.check).toHaveBeenCalledWith('u-1', runningPlan, tx);
    expect(prisma.streamingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u-1', episodeId: 'ep-1', mediaAssetId: 'asset-1' }),
      }),
    );
    expect(view).toMatchObject({ sessionId: 'sess-1', accessType: 'PLAN', startPositionSeconds: 0 });
    expect(view.stream.masterUrl).toContain('/api/playback/s/sess-1/master.m3u8');
    expect(view.reused).toBeUndefined();
  });

  it('serializes creation on a per-owner lock inside one transaction', async () => {
    await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const rawCall = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(String((rawCall[0] as unknown[])[0])).toContain('pg_advisory_xact_lock');
    // The device count runs after the lock, on the transaction client.
    expect(devices.check).toHaveBeenCalledWith('u-1', runningPlan, tx);
    const checkOrder = devices.check.mock.invocationCallOrder[0];
    const createOrder = prisma.streamingSession.create.mock.invocationCallOrder[0];
    expect(checkOrder).toBeLessThan(createOrder);
  });

  it('caches the media duration on the session row at creation', async () => {
    await service.create({ episodeId: 'ep-1', userId: 'u-1' });
    expect(prisma.streamingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationSeconds: 600 }) }),
    );
  });

  it('opens a guest session from X-Guest-Key without a device check or plan read (P4-5)', async () => {
    const guestKey = '123e4567-e89b-4123-a456-426614174000';
    const view = await service.create({ episodeId: 'ep-1', guestKey });

    expect(access.runningPlanOf).not.toHaveBeenCalled();
    expect(access.verify).toHaveBeenCalledWith('ep-1', undefined, null);
    expect(devices.check).not.toHaveBeenCalled();
    expect(ads.scheduleFor).toHaveBeenCalledWith('sess-1', { adFree: false, durationSeconds: 600 });
    expect(view).toMatchObject({ sessionId: 'sess-1' });
  });

  it('hands the same plan snapshot to access, devices and ads (P4-5)', async () => {
    await service.create({ episodeId: 'ep-1', userId: 'u-1' });
    expect(access.runningPlanOf).toHaveBeenCalledTimes(1);
    expect(access.verify).toHaveBeenCalledWith('ep-1', 'u-1', runningPlan);
    expect(devices.check).toHaveBeenCalledWith('u-1', runningPlan, tx);
    expect(ads.scheduleFor).toHaveBeenCalledWith('sess-1', { adFree: false, durationSeconds: 600 });
    access.runningPlanOf.mockResolvedValue({ code: 'PREMIUM', features: { adFree: true } });
    await service.create({ episodeId: 'ep-1', userId: 'u-1' });
    expect(ads.scheduleFor).toHaveBeenLastCalledWith('sess-1', { adFree: true, durationSeconds: 600 });
  });

  it("applies the Free plan's limits and ads to a member with no running plan (BR-34)", async () => {
    const freePlan = { code: 'free', features: { maxConcurrentStreams: 1, adFree: false } };
    access.runningPlanOf.mockResolvedValue(null);
    access.freePlanOf.mockResolvedValue(freePlan);

    await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    // Access still sees "no plan"; only the limits come from the Free plan.
    expect(access.verify).toHaveBeenCalledWith('ep-1', 'u-1', null);
    expect(devices.check).toHaveBeenCalledWith('u-1', freePlan, tx);
    expect(ads.scheduleFor).toHaveBeenCalledWith('sess-1', { adFree: false, durationSeconds: 600 });
  });

  it('reuses the live session on a double tap instead of opening a second row', async () => {
    prisma.streamingSession.findFirst.mockResolvedValue({
      id: 'sess-live',
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
      mediaAssetId: 'asset-1',
    });

    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });

    expect(prisma.streamingSession.create).not.toHaveBeenCalled();
    expect(view).toMatchObject({ sessionId: 'sess-live', reused: true });
  });

  it('hands the live session back to a member at the stream limit instead of refusing', async () => {
    prisma.streamingSession.findFirst.mockResolvedValue({
      id: 'sess-live',
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
      mediaAssetId: 'asset-1',
    });
    devices.check.mockRejectedValue(new Error('CONCURRENT_LIMIT_REACHED'));

    // A reload of the episode being watched takes no new slot, so the limit is never asked.
    await expect(service.create({ episodeId: 'ep-1', userId: 'u-1' })).resolves.toMatchObject({ reused: true });
    expect(devices.check).not.toHaveBeenCalled();
  });

  it('requires exactly one owner', async () => {
    await expect(service.create({ episodeId: 'ep-1' })).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ episodeId: 'ep-1', userId: 'u-1', guestKey: '123e4567-e89b-4123-a456-426614174000' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a malformed guest key', async () => {
    await expect(service.create({ episodeId: 'ep-1', guestKey: 'not-a-uuid' })).rejects.toThrow(BadRequestException);
    expect(access.verify).not.toHaveBeenCalled();
  });

  it('rejects an overlong Idempotency-Key', async () => {
    await expect(service.create({ episodeId: 'ep-1', userId: 'u-1', idempotencyKey: 'k'.repeat(101) })).rejects.toThrow(
      BadRequestException,
    );
    expect(access.verify).not.toHaveBeenCalled();
  });

  it('returns the saved position as a resume hint (step 9)', async () => {
    progress.progress.mockResolvedValue({ found: true, positionSeconds: 320, completed: false });
    const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });
    expect(view).toMatchObject({ resumePositionSeconds: 320 });
  });

  describe('heartbeat / stop / complete', () => {
    const live = (overrides = {}) => ({
      id: 'sess-1',
      userId: 'u-1',
      guestKey: null,
      episodeId: 'ep-1',
      mediaAssetId: 'asset-1',
      accessType: PlaybackAccessType.PLAN,
      durationSeconds: 1200,
      lastProgressAt: null,
      // The previous update landed one beat ago: the server may credit 12s.
      lastHeartbeatAt: new Date(Date.now() - 12_000),
      status: StreamingSessionStatus.ACTIVE,
      lastPositionSeconds: 300,
      totalWatchedSeconds: 600,
      ...overrides,
    });

    /** The `data` of the nth streaming_sessions.updateMany call. */
    const updateData = (n = 0) =>
      ((prisma.streamingSession.updateMany.mock.calls[n] as unknown[])[0] as { data: Record<string, unknown> }).data;

    beforeEach(() => {
      prisma.streamingSession.findUnique.mockResolvedValue(live());
      prisma.streamingSession.updateMany.mockResolvedValue({ count: 1 });
    });

    it('heartbeat persists position and watch time (step 15)', async () => {
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320, watchedSeconds: 12 });
      expect(state).toMatchObject({ sessionId: 'sess-1', positionSeconds: 320, completed: false });
      expect(prisma.streamingSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastPositionSeconds: 320,
            totalWatchedSeconds: { increment: 12 },
            lastProgressAt: expect.any(Date),
          }),
        }),
      );
      expect(progress.save).toHaveBeenCalledWith(
        'u-1',
        'ep-1',
        expect.objectContaining({ positionSeconds: 320, durationSeconds: 1200, completed: false }),
      );
      // The duration rides on the session row; no media_assets read per beat.
      expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled();
    });

    describe('server-credited watch time', () => {
      it('ignores an inflated client claim and credits the measured beat gap', async () => {
        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320, watchedSeconds: 9999 });
        expect(updateData()).toMatchObject({ totalWatchedSeconds: { increment: 12 } });
      });

      it('caps the credit at two heartbeat intervals when the gap is wider', async () => {
        prisma.streamingSession.findUnique.mockResolvedValue(live({ lastHeartbeatAt: new Date(Date.now() - 300_000) }));
        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320, watchedSeconds: 9999 });
        expect(updateData()).toMatchObject({ totalWatchedSeconds: { increment: MAX_WATCH_CREDIT_SECONDS } });
      });

      it('lets an honest-but-lower claim clamp the credit down (paused player)', async () => {
        prisma.streamingSession.findUnique.mockResolvedValue(live({ lastHeartbeatAt: new Date(Date.now() - 20_000) }));
        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320, watchedSeconds: 3 });
        expect(updateData()).toMatchObject({ totalWatchedSeconds: { increment: 3 } });
      });

      it('credits the measured window when the client sends no claim at all', async () => {
        await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 320 });
        expect(updateData()).toMatchObject({ totalWatchedSeconds: { increment: 12 } });
      });

      it('stop also credits the final measured gap before closing', async () => {
        prisma.streamingSession.findUnique.mockResolvedValue(live({ lastHeartbeatAt: new Date(Date.now() - 10_000) }));
        await service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 360 });
        expect(updateData()).toMatchObject({ totalWatchedSeconds: { increment: 10 } });
      });
    });

    it('heartbeat inside the write window only touches the session row', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ lastProgressAt: new Date() }));
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 330, watchedSeconds: 12 });

      expect(state).toMatchObject({ positionSeconds: 330 });
      expect(prisma.streamingSession.updateMany).toHaveBeenCalledTimes(1);
      expect(updateData()).not.toHaveProperty('lastProgressAt');
      expect(progress.save).not.toHaveBeenCalled();
    });

    it('heartbeat writes the resume hint again once the window has passed', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(
        live({ lastProgressAt: new Date(Date.now() - PROGRESS_WRITE_INTERVAL_MS - 1000) }),
      );
      await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 340 });

      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ positionSeconds: 340 }));
      expect(updateData()).toHaveProperty('lastProgressAt', expect.any(Date));
    });

    it('heartbeat past the threshold always lands the completion, window or not', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ lastProgressAt: new Date() }));
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 1100 });

      expect(state).toMatchObject({ completed: true, status: 'ACTIVE' });
      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ completed: true }));
    });

    it('later beats past the threshold keep the once-a-minute cadence', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(
        live({ lastPositionSeconds: 1100, lastProgressAt: new Date() }),
      );
      await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 1110 });
      expect(progress.save).not.toHaveBeenCalled();
    });

    it('stop inside the write window still lands the final position', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ lastProgressAt: new Date() }));
      await service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 360 });
      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ positionSeconds: 360 }));
    });

    it('heartbeat past the threshold marks completion but keeps the session open (steps 18/20)', async () => {
      // The viewer still watches the last minutes: playlists and the slot must stay live.
      const state = await service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 1100 });
      expect(state).toMatchObject({ completed: true, status: 'ACTIVE' });
      expect(updateData()).not.toHaveProperty('endReason');
      expect(updateData()).not.toHaveProperty('status');
    });

    it('stop past the threshold closes the session as COMPLETED', async () => {
      const state = await service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 1150 });
      expect(state).toMatchObject({ completed: true, status: 'ENDED' });
      expect(updateData()).toMatchObject({ endReason: 'COMPLETED' });
    });

    it('stop saves the position and frees the slot without progress for guests (steps 19/21)', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ userId: null, guestKey: 'g-1' }));
      const state = await service.stop('sess-1', { guestKey: 'g-1' }, { positionSeconds: 400 });
      expect(state).toMatchObject({ positionSeconds: 400, status: 'ENDED' });
      expect(progress.save).not.toHaveBeenCalled();
    });

    it('complete below the threshold closes the session without marking it watched (P3-3)', async () => {
      const state = await service.complete('sess-1', { userId: 'u-1' }, {});
      expect(state).toMatchObject({ completed: false, status: 'ENDED', positionSeconds: 300 });
      expect(updateData()).toMatchObject({ endReason: 'STOPPED' });
      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ completed: false }));
    });

    it('complete at the threshold marks the episode completed', async () => {
      const state = await service.complete('sess-1', { userId: 'u-1' }, { positionSeconds: 1100 });
      expect(state).toMatchObject({ completed: true, status: 'ENDED', positionSeconds: 1100 });
      expect(updateData()).toMatchObject({ endReason: 'COMPLETED' });
      expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ completed: true }));
    });

    describe('entitlement lost mid-session (hardening #11)', () => {
      it('ends the session before crediting the beat when the unlock was revoked', async () => {
        prisma.streamingSession.findUnique.mockResolvedValue(live({ accessType: PlaybackAccessType.EPISODE_PURCHASE }));
        access.stillEntitled.mockResolvedValue(false);

        await expect(service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 420 })).rejects.toMatchObject({
          response: expect.objectContaining({
            details: expect.objectContaining({ reason: 'PLAYBACK_ACCESS_REVOKED' }),
          }),
        });
        expect(access.stillEntitled).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'sess-1', userId: 'u-1', episodeId: 'ep-1' }),
        );
        // The row closes as KICKED instead of riding the heartbeat timeout, which also
        // stops the signed playlist URLs pinned to it from being served.
        expect(updateData()).toMatchObject({ status: 'ENDED', endReason: 'KICKED' });
        // The viewer got this far: the final position lands like a stop.
        expect(progress.save).toHaveBeenCalledWith('u-1', 'ep-1', expect.objectContaining({ positionSeconds: 420 }));
      });

      it('ends the session when the plan lapsed mid-episode', async () => {
        access.stillEntitled.mockResolvedValue(false);

        await expect(service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 300 })).rejects.toMatchObject({
          response: expect.objectContaining({
            details: expect.objectContaining({ reason: 'PLAYBACK_ACCESS_REVOKED' }),
          }),
        });
        expect(updateData()).toMatchObject({ status: 'ENDED', endReason: 'KICKED' });
      });

      it('leaves stop and complete alone: leaving a revoked episode must still work', async () => {
        access.stillEntitled.mockResolvedValue(false);

        const stopped = await service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 400 });
        expect(stopped).toMatchObject({ status: 'ENDED', positionSeconds: 400 });
        await expect(service.complete('sess-1', { userId: 'u-1' }, {})).resolves.toMatchObject({ status: 'ENDED' });
        expect(access.stillEntitled).not.toHaveBeenCalled();
      });
    });

    it('refuses a caller who does not own the session', async () => {
      await expect(service.heartbeat('sess-1', { userId: 'u-2' }, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_OWNER' }) }),
      });
      await expect(service.heartbeat('sess-1', {}, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_OWNER' }) }),
      });
    });

    it('refuses a session that already ended', async () => {
      prisma.streamingSession.findUnique.mockResolvedValue(live({ status: StreamingSessionStatus.ENDED }));
      await expect(service.stop('sess-1', { userId: 'u-1' }, { positionSeconds: 1 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_ACTIVE' }) }),
      });
    });

    it('does not write a heartbeat onto a row a concurrent stop already closed (P3-2)', async () => {
      prisma.streamingSession.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.heartbeat('sess-1', { userId: 'u-1' }, { positionSeconds: 999 })).rejects.toMatchObject({
        response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_ACTIVE' }) }),
      });
      expect(prisma.streamingSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1', status: StreamingSessionStatus.ACTIVE },
        }),
      );
      // Nothing is credited or persisted after the session moved on.
      expect(progress.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
