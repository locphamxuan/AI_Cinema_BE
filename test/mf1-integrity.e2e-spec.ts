import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PublicationService } from 'src/modules/publishing/publication.service';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, deliver } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Publication {
  id: string;
  publishedAt: string | null;
  unpublishedAt: string | null;
  unpublishNote: string | null;
}

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** Guards added after the MF-1 audit of 2026-10-02. */
describe('MF-1 integrity (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let reviewer: Actor;
  let creator: Actor;
  let project: ProjectDetail;
  let scheduledAssetId: string;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Một thám tử AI điều tra chuỗi vụ mất tích ở Đà Lạt.',
      ageRating: 'T16',
    });
  });

  afterAll(() => app.close());

  const episodeId = (i: number) => episodesOf(project)[i].id;

  it('refuses an approved version delivered for another episode (BR-14)', async () => {
    scheduledAssetId = (await compliantEpisode(reviewer, creator, episodeId(0))).id;
    await deliver(creator, episodeId(1));

    await expect(
      prisma.episode.update({ where: { id: episodeId(1) }, data: { approvedMediaAssetId: scheduledAssetId } }),
    ).rejects.toThrow(/BR-14/);
  });

  it('withdraws scheduled releases when the project is cancelled, so the scheduler skips them (BR-39)', async () => {
    await reviewer.patch(`/episodes/${episodeId(0)}/coin-price`, { coinPrice: 5 });
    await reviewer.post(`/episodes/${episodeId(0)}/publications`, { scheduledAt: inHours(1) });

    await reviewer.post(`/projects/${project.id}/cancel`, { reason: 'Nhà tài trợ rút vốn.' }, 204);

    const [release] = await reviewer.get<Publication[]>(`/episodes/${episodeId(0)}/publications`);
    expect(release.unpublishedAt).not.toBeNull();
    expect(release.unpublishNote).toBe('Project cancelled: Nhà tài trợ rút vốn.');
    expect(await app.get(PublicationService).publishDue(new Date(Date.now() + 2 * 3_600_000))).toBe(0);
    expect((await prisma.episode.findUniqueOrThrow({ where: { id: episodeId(0) } })).status).toBe('COMPLIANCE_PASSED');
  });

  it('never releases an episode of a cancelled project, whatever writes it (BR-39)', async () => {
    await expect(prisma.episode.update({ where: { id: episodeId(0) }, data: { status: 'PUBLISHED' } })).rejects.toThrow(
      /BR-39/,
    );
  });

  it('keeps a cancelled project out of the public catalog', async () => {
    await reviewer.get(`/movies/${project.id}`, 404);
  });
});
