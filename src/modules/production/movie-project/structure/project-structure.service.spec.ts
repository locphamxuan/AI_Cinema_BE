import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EpisodeStatus, ProjectStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { NewEpisodeDto } from '../dto/create-movie-project.request.dto';
import { ProjectStructureService } from './project-structure.service';

const REVIEWER = { id: 'rev', role: UserRole.CONTENT_REVIEWER };
const PROJECT = { id: 'p1', status: ProjectStatus.ASSIGNED };
const DEADLINE = '2099-01-10';
const NEW_EPISODE = { title: ' Tập mới ', deliveryDeadline: DEADLINE } as NewEpisodeDto;
const SEASON = { id: 's1', movieId: 'p1', releaseStartDate: null, releaseEndDate: null };

describe('ProjectStructureService', () => {
  const db = {
    $queryRaw: jest.fn(),
    season: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    episode: { aggregate: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn(), episode: jest.fn() };
  const service = new ProjectStructureService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
  );

  const episodeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'e1',
    seasonId: 's1',
    status: EpisodeStatus.DRAFT,
    dueDate: null as Date | null,
    deliveryDeadline: new Date(DEADLINE),
    expectedReleaseDate: null as Date | null,
    project: PROJECT,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    access.project.mockResolvedValue(PROJECT);
    access.episode.mockResolvedValue(episodeRow());
    db.season.aggregate.mockResolvedValue({ _max: { seasonNumber: 2 } });
    db.season.create.mockResolvedValue({ id: 's3' });
    db.season.findUnique.mockResolvedValue({ ...SEASON, episodes: [] });
    db.season.findUniqueOrThrow.mockResolvedValue(SEASON);
    db.episode.aggregate.mockResolvedValue({ _max: { episodeNumber: 7 } });
    db.episode.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'new', ...data }));
    db.episode.update.mockResolvedValue({ id: 'e1' });
    db.season.update.mockResolvedValue({ id: 's1' });
  });

  describe('addSeason', () => {
    it('numbers the season and its episodes where the movie left off, under the project lock', async () => {
      await service.addSeason('p1', { title: 'Mùa 3', episodes: [NEW_EPISODE, NEW_EPISODE] }, REVIEWER);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.season.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ movieId: 'p1', seasonNumber: 3, title: 'Mùa 3' }),
      });
      expect(db.episode.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ episodeNumber: 8, title: 'Tập mới', seasonId: 's3' }),
      });
      expect(db.episode.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ episodeNumber: 9 }),
      });
    });

    it('starts at 1 on an empty movie and refuses a closed project', async () => {
      db.season.aggregate.mockResolvedValue({ _max: { seasonNumber: null } });
      db.episode.aggregate.mockResolvedValue({ _max: { episodeNumber: null } });
      await service.addSeason('p1', { episodes: [NEW_EPISODE] }, REVIEWER);
      expect(db.season.create).toHaveBeenCalledWith({ data: expect.objectContaining({ seasonNumber: 1 }) });
      expect(db.episode.create).toHaveBeenCalledWith({ data: expect.objectContaining({ episodeNumber: 1 }) });

      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.COMPLETED });
      await expect(service.addSeason('p1', { episodes: [] }, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateSeason', () => {
    it('saves the title and keeps the window dates not sent', async () => {
      const start = new Date('2099-02-01');
      db.season.findUnique.mockResolvedValue({ ...SEASON, releaseStartDate: start, episodes: [] });
      await service.updateSeason('s1', { title: 'Mới', releaseEndDate: '2099-03-01' }, REVIEWER);
      expect(db.season.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { title: 'Mới', releaseStartDate: start, releaseEndDate: new Date('2099-03-01') },
      });
    });

    it('refuses a window that leaves an expected release outside, naming the episode', async () => {
      db.season.findUnique.mockResolvedValue({
        ...SEASON,
        episodes: [{ episodeNumber: 4, expectedReleaseDate: new Date('2099-06-01') }],
      });
      await expect(service.updateSeason('s1', { releaseEndDate: '2099-03-01' }, REVIEWER)).rejects.toThrow(/Episode 4/);
      expect(db.season.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown season and refuses an inverted window', async () => {
      await expect(
        service.updateSeason('s1', { releaseStartDate: '2099-03-02', releaseEndDate: '2099-03-01' }, REVIEWER),
      ).rejects.toBeInstanceOf(BadRequestException);
      db.season.findUnique.mockResolvedValue(null);
      await expect(service.updateSeason('x', {}, REVIEWER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('addEpisode', () => {
    it('adds a draft episode with no studio due date before the hand-off', async () => {
      db.season.findUnique.mockResolvedValue(SEASON);
      await expect(service.addEpisode('s1', NEW_EPISODE, REVIEWER)).resolves.toMatchObject({
        episodeNumber: 8,
        status: EpisodeStatus.DRAFT,
      });
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      const [{ data }] = db.episode.create.mock.calls[0] as [{ data: object }];
      expect(data).not.toHaveProperty('dueDate');
    });

    it('makes the studio due on the deadline when added after the hand-off', async () => {
      db.season.findUnique.mockResolvedValue(SEASON);
      access.project.mockResolvedValue({ ...PROJECT, status: ProjectStatus.IN_PRODUCTION });
      await expect(service.addEpisode('s1', NEW_EPISODE, REVIEWER)).resolves.toMatchObject({
        status: EpisodeStatus.AWAITING_MEDIA,
        dueDate: new Date(DEADLINE),
      });
    });

    it('answers 404 for an unknown season', async () => {
      db.season.findUnique.mockResolvedValue(null);
      await expect(service.addEpisode('x', NEW_EPISODE, REVIEWER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateEpisode', () => {
    it('writes plain fields without touching the schedule', async () => {
      await service.updateEpisode('e1', { title: 'Tên' }, REVIEWER);
      expect(db.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { title: 'Tên' } });
      expect(db.season.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('moves the studio due date with the deadline once handed off', async () => {
      access.episode.mockResolvedValue(episodeRow({ dueDate: new Date(DEADLINE) }));
      await service.updateEpisode('e1', { deliveryDeadline: '2099-02-20' }, REVIEWER);
      expect(db.episode.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { deliveryDeadline: new Date('2099-02-20'), dueDate: new Date('2099-02-20') },
      });
    });

    it('sets the expected release alone', async () => {
      await service.updateEpisode('e1', { expectedReleaseDate: '2099-02-20' }, REVIEWER);
      expect(db.episode.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { expectedReleaseDate: new Date('2099-02-20') },
      });
    });

    it('freezes the deadline and the duration after approval, and closed projects', async () => {
      access.episode.mockResolvedValue(episodeRow({ status: EpisodeStatus.APPROVED }));
      await expect(service.updateEpisode('e1', { deliveryDeadline: '2099-02-20' }, REVIEWER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.updateEpisode('e1', { targetDurationSeconds: 60 }, REVIEWER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      access.episode.mockResolvedValue(episodeRow({ project: { ...PROJECT, status: ProjectStatus.CANCELLED } }));
      await expect(service.updateEpisode('e1', { title: 'x' }, REVIEWER)).rejects.toBeInstanceOf(ConflictException);
      expect(db.episode.update).not.toHaveBeenCalled();
    });
  });
});
