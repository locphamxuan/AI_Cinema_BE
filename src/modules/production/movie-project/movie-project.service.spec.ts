import { ConflictException } from '@nestjs/common';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioService } from 'src/modules/production/studio/studio.service';
import type { CreateMovieProjectRequestDto } from './dto/create-movie-project.request.dto';
import { MovieProjectService } from './movie-project.service';
import type { ProjectLifecycleService } from './project-lifecycle.service';

jest.mock('@nestarc/pagination', () => ({ paginate: jest.fn() }));

const ADMIN = { id: 'admin', role: UserRole.ADMIN };
const QUERY = { path: '', page: 1, limit: 10 } as PaginateQuery;
const NEW_PROJECT = {
  title: ' Căn Hộ 13 ',
  ideaDescription: ' Kinh dị ',
  reviewerId: 'rev',
  genreIds: ['g1'],
} as CreateMovieProjectRequestDto;

describe('MovieProjectService', () => {
  const paginateMock = paginate as jest.MockedFunction<typeof paginate>;
  const db = {
    movie: { create: jest.fn(), update: jest.fn() },
    movieProject: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
    season: { create: jest.fn() },
    episode: { createMany: jest.fn() },
    genre: { count: jest.fn() },
    movieGenre: { deleteMany: jest.fn(), createMany: jest.fn() },
    auditLog: { groupBy: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn(), readableWhere: jest.fn() };
  const costs = { summary: jest.fn() };
  const studios = { assertUsable: jest.fn() };
  const lifecycle = {
    assertActive: jest.fn(),
    announceReviewer: jest.fn(),
    announceStudio: jest.fn(),
    assignCreator: jest.fn(),
  };
  const auditLog = { record: jest.fn(), findForProject: jest.fn() };
  const service = new MovieProjectService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    costs as unknown as ProductionCostService,
    studios as unknown as StudioService,
    lifecycle as unknown as ProjectLifecycleService,
    auditLog as unknown as AuditLogService,
  );

  const detailRow = {
    id: 'p1',
    status: ProjectStatus.DRAFT,
    _count: { changeRequests: 2 },
    movie: { id: 'p1', title: 'Phim', genres: [{ genre: { id: 'g1', name: 'Kinh dị' } }], seasons: [] },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue({ id: 'p1', status: ProjectStatus.DRAFT, studioId: null, handedOffAt: null });
    access.readableWhere.mockResolvedValue({ reviewerId: 'rev' });
    db.genre.count.mockResolvedValue(1);
    db.movie.create.mockResolvedValue({ id: 'p1' });
    db.season.create.mockResolvedValue({ id: 's1' });
    db.movieProject.findUniqueOrThrow.mockResolvedValue(detailRow);
    db.auditLog.groupBy.mockResolvedValue([]);
    costs.summary.mockResolvedValue({ remainingVnd: 5 });
  });

  describe('create', () => {
    it('creates the project without seasons, tells the Reviewer and audits it', async () => {
      await expect(service.create(NEW_PROJECT, ADMIN)).resolves.toMatchObject({ id: 'p1', openChangeRequests: 2 });
      expect(lifecycle.assertActive).toHaveBeenCalledWith('rev', UserRole.CONTENT_REVIEWER);
      expect(db.movie.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Căn Hộ 13',
          project: { create: { ideaDescription: 'Kinh dị', studioId: undefined, reviewerId: 'rev' } },
        }),
      });
      expect(db.season.create).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.PROJECT_CREATED, entityId: 'p1', actorId: 'admin' }),
        db,
      );
      expect(lifecycle.announceReviewer).toHaveBeenCalledWith('p1');
      expect(lifecycle.assignCreator).not.toHaveBeenCalled();
    });

    it('numbers episodes across seasons and assigns the Creator after the transaction', async () => {
      const episode = (title: string) => ({ title, deliveryDeadline: '2099-01-10' });
      await service.create(
        {
          ...NEW_PROJECT,
          studioId: 'st1',
          creatorId: 'cre',
          seasons: [{ episodes: [episode('A '), episode('B')] }, { title: 'Mùa 2', episodes: [episode('C')] }],
        } as CreateMovieProjectRequestDto,
        ADMIN,
      );
      expect(studios.assertUsable).toHaveBeenCalledWith('st1');
      expect(lifecycle.assertActive).toHaveBeenCalledWith('cre', UserRole.CONTENT_CREATOR);
      expect(db.season.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ movieId: 'p1', seasonNumber: 1 }),
      });
      expect(db.season.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ seasonNumber: 2, title: 'Mùa 2' }),
      });
      expect(db.episode.createMany).toHaveBeenNthCalledWith(1, {
        data: [
          expect.objectContaining({ episodeNumber: 1, title: 'A', seasonId: 's1' }),
          expect.objectContaining({ episodeNumber: 2, title: 'B' }),
        ],
      });
      expect(db.episode.createMany).toHaveBeenNthCalledWith(2, {
        data: [expect.objectContaining({ episodeNumber: 3, title: 'C' })],
      });
      expect(lifecycle.assignCreator).toHaveBeenCalledWith('p1', 'cre', ADMIN);
    });
  });

  describe('list', () => {
    const row = (id: string, updatedAt: Date) => ({
      id,
      updatedAt,
      _count: { changeRequests: 1 },
      movie: { title: `Phim ${id}`, _count: { episodes: 4 } },
    });

    it('flattens the catalog fields and takes the newest content event as last activity', async () => {
      const updatedAt = new Date('2026-01-01T00:00:00Z');
      const logged = new Date('2026-02-01T00:00:00Z');
      paginateMock.mockResolvedValueOnce({ data: [row('p1', updatedAt), row('p2', updatedAt)], meta: {} } as never);
      db.auditLog.groupBy.mockResolvedValue([
        { projectId: 'p1', _max: { createdAt: logged } },
        { projectId: null, _max: { createdAt: logged } },
      ]);

      const page = await service.list(QUERY, ADMIN);

      expect(page.data).toEqual([
        expect.objectContaining({
          id: 'p1',
          title: 'Phim p1',
          _count: { episodes: 4 },
          openChangeRequests: 1,
          lastActivityAt: logged,
        }),
        expect.objectContaining({ id: 'p2', lastActivityAt: updatedAt }),
      ]);
      expect(paginateMock).toHaveBeenCalledWith(
        QUERY,
        db.movieProject,
        expect.objectContaining({ where: { AND: [{ reviewerId: 'rev' }, {}] } }),
      );
    });

    it('searches on the movie title, which the paginator cannot reach', async () => {
      paginateMock.mockResolvedValueOnce({ data: [], meta: {} } as never);
      await service.list({ ...QUERY, search: 'căn' }, ADMIN);
      expect(paginateMock).toHaveBeenCalledWith(
        expect.anything(),
        db.movieProject,
        expect.objectContaining({
          where: { AND: [{ reviewerId: 'rev' }, { movie: { title: { contains: 'căn', mode: 'insensitive' } } }] },
        }),
      );
    });
  });

  it('answers the detail with flattened genres, cost and revision summary', async () => {
    await expect(service.detail('p1', ADMIN)).resolves.toMatchObject({
      id: 'p1',
      title: 'Phim',
      genres: [{ id: 'g1', name: 'Kinh dị' }],
      cost: { remainingVnd: 5 },
      openChangeRequests: 2,
    });
    expect(access.project).toHaveBeenCalledWith('p1', ADMIN, 'read');
  });

  describe('update', () => {
    it('writes catalog and project fields to their own tables and leaves genres alone', async () => {
      await service.update('p1', { title: 'Mới', ideaDescription: 'Ý mới' }, ADMIN);
      expect(db.movie.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { title: 'Mới' } });
      expect(db.movieProject.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { ideaDescription: 'Ý mới' } });
      expect(db.movieGenre.deleteMany).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: CONTENT_EVENT.PROJECT_UPDATED,
          payload: { fields: ['title', 'ideaDescription'] },
        }),
        db,
      );
    });

    it('replaces the genres when new ones are sent', async () => {
      await service.update('p1', { genreIds: ['g1'] }, ADMIN);
      expect(db.movieGenre.deleteMany).toHaveBeenCalledWith({ where: { movieId: 'p1' } });
      expect(db.movieGenre.createMany).toHaveBeenCalledWith({ data: [{ movieId: 'p1', genreId: 'g1' }] });
    });

    it('checks a new studio, and refuses one once the project was handed off', async () => {
      studios.assertUsable.mockResolvedValueOnce({ id: 'st2', name: 'Studio B' });
      await service.update('p1', { studioId: 'st2' }, ADMIN);
      expect(studios.assertUsable).toHaveBeenCalledWith('st2');
      expect(lifecycle.announceStudio).toHaveBeenCalledWith('p1', { id: 'st2', name: 'Studio B' }, expect.anything());

      access.project.mockResolvedValue({ id: 'p1', status: ProjectStatus.IN_PRODUCTION, handedOffAt: new Date() });
      await expect(service.update('p1', { studioId: 'st2' }, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to edit a cancelled project', async () => {
      access.project.mockResolvedValue({ id: 'p1', status: ProjectStatus.CANCELLED });
      await expect(service.update('p1', {}, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  it('reads the event history only after checking access', async () => {
    auditLog.findForProject.mockResolvedValue([{ id: 'a1' }]);
    await expect(service.events('p1', ADMIN)).resolves.toEqual([{ id: 'a1' }]);
    expect(access.project).toHaveBeenCalledWith('p1', ADMIN, 'read');
  });
});
