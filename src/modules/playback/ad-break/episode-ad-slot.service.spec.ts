import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { EpisodeAdSlotService } from './episode-ad-slot.service';

describe('EpisodeAdSlotService (BR-32)', () => {
  const tx = { episodeAdSlot: { deleteMany: jest.fn(), createMany: jest.fn() } };
  const prisma = {
    episode: { findUnique: jest.fn() },
    episodeAdSlot: { findMany: jest.fn() },
    ad: { count: jest.fn() },
    $transaction: jest.fn((work: (db: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const audit = { record: jest.fn() };
  const service = new EpisodeAdSlotService(prisma as unknown as PrismaService, audit as unknown as AuditLogService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.episode.findUnique.mockResolvedValue({ approvedMediaAsset: { durationSeconds: 1200 } });
    prisma.episodeAdSlot.findMany.mockResolvedValue([]);
    prisma.ad.count.mockResolvedValue(1);
  });

  it('answers RANDOM while the Admin has placed no cue', async () => {
    await expect(service.slots('ep-1')).resolves.toEqual({
      episodeId: 'ep-1',
      durationSeconds: 1200,
      mode: 'RANDOM',
      slots: [],
    });
  });

  it('replaces the whole set: where and how many times ads are inserted, audited', async () => {
    prisma.episodeAdSlot.findMany.mockResolvedValue([
      { id: 's1', positionSeconds: 300, ad: { id: 'ad-1', title: 'Ad' } },
      { id: 's2', positionSeconds: 900, ad: null },
    ]);

    const view = await service.replace('ep-1', 'admin-1', {
      slots: [{ positionSeconds: 300, adId: 'ad-1' }, { positionSeconds: 900 }],
    });

    expect(tx.episodeAdSlot.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'ep-1' } });
    expect(tx.episodeAdSlot.createMany).toHaveBeenCalledWith({
      data: [
        { episodeId: 'ep-1', positionSeconds: 300, adId: 'ad-1', createdById: 'admin-1' },
        { episodeId: 'ep-1', positionSeconds: 900, adId: null, createdById: 'admin-1' },
      ],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EPISODE_AD_SLOTS_SET', entityId: 'ep-1', actorId: 'admin-1' }),
      tx,
    );
    expect(view).toMatchObject({ mode: 'MANUAL', slots: [{ positionSeconds: 300 }, { positionSeconds: 900 }] });
  });

  it('goes back to random cues on an empty list', async () => {
    await service.replace('ep-1', 'admin-1', { slots: [] });
    expect(tx.episodeAdSlot.deleteMany).toHaveBeenCalled();
    expect(tx.episodeAdSlot.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['AD_SLOT_DUPLICATE', [{ positionSeconds: 300 }, { positionSeconds: 300 }]],
    ['AD_SLOT_OUT_OF_RANGE', [{ positionSeconds: 1200 }]],
  ])('refuses %s', async (reason, slots) => {
    await expect(service.replace('ep-1', 'admin-1', { slots })).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason }) }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown pinned ad and an unknown episode', async () => {
    prisma.ad.count.mockResolvedValue(0);
    await expect(
      service.replace('ep-1', 'admin-1', { slots: [{ positionSeconds: 300, adId: 'missing' }] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ details: { reason: 'AD_NOT_FOUND' } }) });

    prisma.episode.findUnique.mockResolvedValue(null);
    await expect(service.slots('missing')).rejects.toMatchObject({
      response: expect.objectContaining({ details: { reason: 'EPISODE_NOT_FOUND' } }),
    });
  });

  it('accepts any second before an approved version exists', async () => {
    prisma.episode.findUnique.mockResolvedValue({ approvedMediaAsset: null });
    await expect(service.replace('ep-1', 'admin-1', { slots: [{ positionSeconds: 5000 }] })).resolves.toBeDefined();
  });
});
