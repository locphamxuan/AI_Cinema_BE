import { ConflictException } from '@nestjs/common';
import { EpisodeStatus } from '@prisma/client';
import { FinalFilmService } from './final-film.service';

function setup(episode: Record<string, unknown>) {
  const db = {
    episode: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'e1' }),
    },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = {
    episode: jest.fn().mockResolvedValue({
      id: 'e1',
      movieId: 'p1',
      episodeNumber: 1,
      movie: { title: 'Phim A' },
      project: { reviewerId: 'rev' },
      status: EpisodeStatus.COMPLIANCE_PASSED,
      coinPrice: 10,
      finalConfirmedAt: null,
      ...episode,
    }),
  };
  const notifications = { notify: jest.fn(), adminIds: jest.fn().mockResolvedValue(['admin']) };
  const service = new FinalFilmService(
    prisma as never,
    access as never,
    notifications as never,
    {
      record: jest.fn(),
    } as never,
  );
  return { service, db, notifications };
}

describe('FinalFilmService (MF-1 §5–6)', () => {
  it('lets the Reviewer confirm a compliant, priced version and tells the Admins', async () => {
    const { service, db, notifications } = setup({});
    await service.confirm('e1', { id: 'rev', role: 'CONTENT_REVIEWER' });
    expect(db.episode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalConfirmedById: 'rev' }) }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(['admin'], expect.anything(), db);
  });

  it('refuses to confirm before compliance', async () => {
    await expect(
      setup({ status: EpisodeStatus.LABELED }).service.confirm('e1', { id: 'rev', role: 'CONTENT_REVIEWER' }),
    ).rejects.toThrow(ConflictException);
  });

  it('confirms an unpriced episode: the Admin prices it afterwards, before publishing (2026-11-11)', async () => {
    const { service, db } = setup({ coinPrice: null });
    await service.confirm('e1', { id: 'rev', role: 'CONTENT_REVIEWER' });
    expect(db.episode.updateMany).toHaveBeenCalled();
  });

  it('sends a confirmed Final Film back to the Reviewer, never to the studio', async () => {
    const { service, db, notifications } = setup({ finalConfirmedAt: new Date() });
    await service.reject('e1', 'Cảnh cuối quá tối', { id: 'admin', role: 'ADMIN' });
    expect(db.episode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finalRejectionNote: 'Cảnh cuối quá tối' }) }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(['rev'], expect.anything(), db);
  });
});
