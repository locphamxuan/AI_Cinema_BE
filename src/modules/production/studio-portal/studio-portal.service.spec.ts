import { NotFoundException } from '@nestjs/common';
import { ContentReviewDecision, ScriptStatus, UserRole } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import type { StudioAccountService } from 'src/modules/production/studio/studio-account.service';
import { StudioPortalService } from './studio-portal.service';

const STUDIO_USER = { id: 'su1', role: UserRole.STUDIO };

describe('StudioPortalService', () => {
  const prisma = {
    studio: { findUniqueOrThrow: jest.fn() },
    movieProject: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    episode: { findMany: jest.fn() },
  };
  const access = { studioProject: jest.fn() };
  const accounts = { studioOf: jest.fn() };
  const service = new StudioPortalService(
    prisma as unknown as PrismaService,
    access as unknown as ProjectAccessService,
    accounts as unknown as StudioAccountService,
  );

  const projectRow = (scriptStatus: ScriptStatus | null) => ({
    id: 'p1',
    status: 'IN_PRODUCTION',
    ideaDescription: 'Ý tưởng',
    handedOffAt: null,
    movie: { title: 'Phim', synopsis: 'Tóm tắt', ageRating: 'T13', defaultLanguage: 'vi' },
    script: scriptStatus
      ? { status: scriptStatus, finalizedAt: null, currentVersion: 2, versions: [{ version: 2, content: 'Bản 2' }] }
      : null,
    contracts: [{ id: 'c1' }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.studioOf.mockResolvedValue('s1');
    access.studioProject.mockResolvedValue(undefined);
    prisma.episode.findMany.mockResolvedValue([]);
  });

  it('answers the studio of the caller and its public profile', async () => {
    prisma.studio.findUniqueOrThrow.mockResolvedValue({ id: 's1', name: 'Lumen' });
    await expect(service.studioOf(STUDIO_USER)).resolves.toBe('s1');
    await expect(service.me(STUDIO_USER)).resolves.toEqual({ id: 's1', name: 'Lumen' });
    expect(prisma.studio.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
  });

  it('lists only projects the studio holds a contract for, with the latest round and episode count', async () => {
    prisma.movieProject.findMany.mockResolvedValue([
      {
        id: 'p1',
        status: 'ASSIGNED',
        handedOffAt: null,
        movie: { title: 'Phim A', _count: { episodes: 3 } },
        contracts: [{ id: 'c2', status: 'SENT', costVnd: null }],
      },
      {
        id: 'p2',
        status: 'IN_PRODUCTION',
        handedOffAt: null,
        movie: { title: 'Phim B', _count: { episodes: 0 } },
        contracts: [],
      },
    ]);
    await expect(service.projects(STUDIO_USER)).resolves.toEqual([
      {
        id: 'p1',
        status: 'ASSIGNED',
        handedOffAt: null,
        title: 'Phim A',
        episodeCount: 3,
        contract: { id: 'c2', status: 'SENT', costVnd: null },
      },
      { id: 'p2', status: 'IN_PRODUCTION', handedOffAt: null, title: 'Phim B', episodeCount: 0, contract: null },
    ]);
    expect(prisma.movieProject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studioId: 's1', contracts: { some: { studioId: 's1' } } } }),
    );
  });

  it('shows the Final Script and the latest delivery with its change request', async () => {
    prisma.movieProject.findUniqueOrThrow.mockResolvedValue(projectRow(ScriptStatus.FINAL));
    const comments = { text: 'Sửa âm thanh' };
    prisma.episode.findMany.mockResolvedValue([
      {
        id: 'e1',
        episodeNumber: 1,
        mediaAssets: [{ id: 'm2', version: 2, contentReviews: [{ comments, createdAt: new Date(0) }] }],
      },
      { id: 'e2', episodeNumber: 2, mediaAssets: [] },
    ]);

    const view = await service.project('p1', STUDIO_USER);

    expect(access.studioProject).toHaveBeenCalledWith('p1', 's1');
    expect(view).toMatchObject({
      id: 'p1',
      title: 'Phim',
      synopsis: 'Tóm tắt',
      finalScript: { version: 2, content: 'Bản 2' },
      contracts: [{ id: 'c1' }],
    });
    expect(view).not.toHaveProperty('script');
    expect(view.episodes[0].latestDelivery).toEqual({
      id: 'm2',
      version: 2,
      contentReviews: undefined,
      changeRequest: { comments, createdAt: new Date(0) },
    });
    expect(view.episodes[1].latestDelivery).toBeNull();
    expect(prisma.episode.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { movieId: 'p1' } }));
    const [{ select }] = prisma.episode.findMany.mock.calls[0] as [
      { select: { mediaAssets: { select: { contentReviews: { where: unknown } } } } },
    ];
    expect(select.mediaAssets.select.contentReviews.where).toEqual({
      decision: ContentReviewDecision.CHANGES_REQUESTED,
    });
  });

  it('hides a script that is not Final yet, or missing', async () => {
    prisma.movieProject.findUniqueOrThrow.mockResolvedValue(projectRow(ScriptStatus.REVIEWER_APPROVED));
    await expect(service.project('p1', STUDIO_USER)).resolves.toMatchObject({ finalScript: null });
    prisma.movieProject.findUniqueOrThrow.mockResolvedValue(projectRow(null));
    await expect(service.project('p1', STUDIO_USER)).resolves.toMatchObject({ finalScript: null });
  });

  it('never reads a project the studio has no part in', async () => {
    access.studioProject.mockRejectedValue(new NotFoundException());
    await expect(service.project('p9', STUDIO_USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.movieProject.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
