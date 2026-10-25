import { NotFoundException } from '@nestjs/common';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { FilmSentService } from './film-sent.service';
import type { FilmSentRequestDto } from './film-sent.request.dto';

const dto: FilmSentRequestDto = {
  studioEmail: 'contact@anhtrang.studio',
  creatorEmail: 'creator@aicinema.local',
  movieTitle: 'Hành Trình',
  scope: 'Mùa 2',
  version: 'v2',
  label: 'Bản dựng cuối',
  episodes: [
    { episode: 1, fileName: 'tap-1.mp4', url: 'http://studio.test/films/a/tap-1.mp4' },
    { episode: 2, fileName: 'tap-2.mp4', url: 'http://studio.test/films/b/tap-2.mp4' },
  ],
};

/** The episodes of the hand-off scope, in brief order, with the Creator each one is given to. */
function setup(handoff: unknown, owners: (string | null)[] = [null, null]) {
  const scope = owners.map((assignedCreatorId, i) => ({ id: `e${i + 1}`, assignedCreatorId }));
  const tx = {
    studioHandoff: { findFirst: jest.fn().mockResolvedValue(handoff), update: jest.fn() },
    episode: { findMany: jest.fn().mockResolvedValue(scope) },
    studioFilmLink: { upsert: jest.fn() },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new FilmSentService(prisma as never, auditLog as never, notifications as never);
  return { service, tx, auditLog, notifications };
}

describe('FilmSentService', () => {
  const handoff = {
    id: 'h1',
    movieId: 'm1',
    createdById: 'c2',
    movie: { id: 'm1', title: 'Hành Trình', creatorId: 'c1', reviewerId: 'r1' },
  };

  it('remembers the film on the hand-off and tells the sending Creator, the main Creator and the Reviewer', async () => {
    const { service, tx, auditLog, notifications } = setup(handoff);

    const result = await service.record(dto);

    expect(result.handoffId).toBe('h1');
    expect(tx.studioHandoff.update).toHaveBeenCalledWith({
      where: { id: 'h1' },
      data: expect.objectContaining({ filmSentNote: expect.stringContaining('v2') }),
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, movieId: 'm1' }), tx);
    expect(notifications.notify).toHaveBeenCalledWith(
      ['c2', 'c1', 'r1'],
      expect.objectContaining({ type: NOTIFICATION_TYPE.STUDIO_FILM_SENT, link: '/projects/m1/studio' }),
      tx,
    );
  });

  it('also tells the Creators given episodes of the season, once each', async () => {
    const { service, tx, notifications } = setup({ ...handoff, seasonId: 's2' }, ['c3', 'c1', 'c3']);

    await service.record(dto);

    expect(tx.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { movieId: 'm1', seasonId: 's2' }, orderBy: { episodeNumber: 'asc' } }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(['c2', 'c1', 'r1', 'c3'], expect.anything(), tx);
  });

  it('keeps one link per episode of the scope, matched by its position in the order', async () => {
    const { service, tx } = setup(handoff);

    await service.record({
      ...dto,
      episodes: [...dto.episodes, { episode: 9, fileName: 'x.mp4', url: 'http://x.test/x' }],
    });

    expect(tx.studioFilmLink.upsert).toHaveBeenCalledTimes(2);
    expect(tx.studioFilmLink.upsert).toHaveBeenCalledWith({
      where: { handoffId_episodeId: { handoffId: 'h1', episodeId: 'e2' } },
      create: expect.objectContaining({ handoffId: 'h1', episodeId: 'e2', version: 'v2', url: dto.episodes[1].url }),
      update: expect.objectContaining({ version: 'v2', fileName: 'tap-2.mp4', url: dto.episodes[1].url }),
    });
  });

  it('looks a season scope up by its number and a whole-project scope by no season', async () => {
    const season = setup(handoff);
    await season.service.record(dto);
    expect(season.tx.studioHandoff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ season: { seasonNumber: 2 } }) }),
    );

    const whole = setup(handoff);
    await whole.service.record({ ...dto, scope: 'Toàn bộ dự án' });
    expect(whole.tx.studioHandoff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ seasonId: null }) }),
    );
  });

  it('matches the Creator who sent the brief as well as the main Creator', async () => {
    const { service, tx } = setup(handoff);
    await service.record(dto);
    const email = { equals: dto.creatorEmail, mode: 'insensitive' };
    expect(tx.studioHandoff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ createdBy: { email } }, { movie: { creator: { email } } }],
        }),
      }),
    );
  });

  it('refuses a film that matches no open hand-off', async () => {
    const { service, notifications } = setup(null);

    await expect(service.record(dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
