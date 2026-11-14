import { ConflictException } from '@nestjs/common';
import { Prisma, StreamingSessionStatus } from '@prisma/client';
import { sessionHarness } from './streaming-session.test-harness';

describe('StreamingSessionService.create with an Idempotency-Key', () => {
  const { service, prisma, reset } = sessionHarness();
  beforeEach(reset);

  describe('Idempotency-Key', () => {
    const prior = (overrides = {}) => ({
      id: 'sess-first',
      userId: 'u-1',
      guestKey: null,
      episodeId: 'ep-1',
      mediaAssetId: 'asset-1',
      status: StreamingSessionStatus.ACTIVE,
      startPositionSeconds: 0,
      ...overrides,
    });

    it('replays the first session for the same key instead of opening a new row', async () => {
      prisma.streamingSession.findFirst.mockResolvedValueOnce(prior());
      const view = await service.create({ episodeId: 'ep-1', userId: 'u-1', idempotencyKey: 'key-1' });

      expect(view).toMatchObject({ sessionId: 'sess-first', reused: true, idempotent: true });
      expect(prisma.streamingSession.create).not.toHaveBeenCalled();
    });

    it('refuses a key already used for another episode', async () => {
      prisma.streamingSession.findFirst.mockResolvedValueOnce(prior({ episodeId: 'ep-9' }));
      await expect(service.create({ episodeId: 'ep-1', userId: 'u-1', idempotencyKey: 'key-1' })).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.streamingSession.create).not.toHaveBeenCalled();
    });

    it('falls back to the winner when two owners race the same key (P2002)', async () => {
      prisma.streamingSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(prior());
      prisma.streamingSession.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      const view = await service.create({ episodeId: 'ep-1', userId: 'u-1', idempotencyKey: 'key-1' });
      expect(view).toMatchObject({ sessionId: 'sess-first', idempotent: true });
    });

    it('rotates the row when the episode was re-published since (live path)', async () => {
      prisma.streamingSession.findFirst.mockResolvedValueOnce({
        id: 'sess-old',
        status: StreamingSessionStatus.ACTIVE,
        startPositionSeconds: 0,
        mediaAssetId: 'asset-0',
      });
      const view = await service.create({ episodeId: 'ep-1', userId: 'u-1' });

      expect(prisma.streamingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-old' },
          data: expect.objectContaining({ status: 'ENDED', endReason: 'SUPERSEDED' }),
        }),
      );
      expect(view).toMatchObject({ sessionId: 'sess-1' });
      expect(view).not.toMatchObject({ reused: true });
    });

    it('moves the key to a fresh row when the replayed session points at stale media', async () => {
      prisma.streamingSession.findFirst
        .mockResolvedValueOnce(prior({ mediaAssetId: 'asset-0' }))
        .mockResolvedValueOnce(null);
      const view = await service.create({ episodeId: 'ep-1', userId: 'u-1', idempotencyKey: 'key-1' });

      expect(prisma.streamingSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-first' },
          data: expect.objectContaining({ endReason: 'SUPERSEDED', idempotencyKey: null }),
        }),
      );
      expect(prisma.streamingSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: 'key-1' }) }),
      );
      expect(view).toMatchObject({ sessionId: 'sess-1' });
    });
  });
});
