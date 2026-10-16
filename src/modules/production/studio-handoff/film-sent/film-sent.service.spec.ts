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
  episodeCount: 3,
};

function setup(handoff: unknown, coCreators: string[] = []) {
  const tx = {
    studioHandoff: { findFirst: jest.fn().mockResolvedValue(handoff), update: jest.fn() },
    episode: { findMany: jest.fn().mockResolvedValue(coCreators.map((assignedCreatorId) => ({ assignedCreatorId }))) },
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
    const { service, tx, notifications } = setup({ ...handoff, seasonId: 's2' }, ['c3', 'c1']);

    await service.record(dto);

    expect(tx.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { movieId: 'm1', assignedCreatorId: { not: null }, seasonId: 's2' } }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(['c2', 'c1', 'r1', 'c3'], expect.anything(), tx);
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
