import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, deliver } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Detail extends ProjectDetail {
  seasons: { episodes: { id: string; episodeNumber: number; status: string; revisionStartedAt: string | null }[] }[];
  revision: { episodeCount: number; bySeason: { seasonNumber: number; episodeNumbers: number[] }[] };
}
interface Publication {
  id: string;
  publishedAt: string | null;
  unpublishMode: string | null;
}
type Bell = { data: { type: string; body: string; payload: { episodeId: string } }[] };

describe('Episode taken down to be fixed (BR-56)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Hai chị em đi tìm người cha mất tích trong thành phố tương lai.',
      ageRating: 'T16',
    });
    for (const episode of episodesOf(project)) {
      await compliantEpisode(reviewer, creator, episode.id);
      await reviewer.patch(`/episodes/${episode.id}/coin-price`, { coinPrice: 10 });
      await reviewer.post(`/episodes/${episode.id}/publications`, {});
    }
  });

  afterAll(() => app.close());

  const episodeId = (i: number) => episodesOf(project)[i].id;
  const detail = () => reviewer.get<Detail>(`/projects/${project.id}`);
  const episodeIn = (d: Detail, i: number) => d.seasons.flatMap((s) => s.episodes).find((e) => e.id === episodeId(i))!;
  const liveRelease = async (i: number) =>
    (await reviewer.get<Publication[]>(`/episodes/${episodeId(i)}/publications`)).find((p) => p.publishedAt)!;

  it('starts from a completed movie', async () => {
    expect((await detail()).status).toBe('COMPLETED');
  });

  it('sends the episode back to the Creator with the reason; the movie is UNDER_REVISION', async () => {
    const release = await liveRelease(0);
    const after = await reviewer.post<Publication[]>(
      `/publications/${release.id}/unpublish`,
      {
        mode: 'REVISION',
        reason: 'COMPLIANCE_ISSUE',
        note: 'Nhân vật phụ giống một ca sĩ có thật, nhờ studio đổi mặt.',
      },
      200,
    );
    expect(after[0].unpublishMode).toBe('REVISION');

    const d = await detail();
    expect(d.status).toBe('UNDER_REVISION');
    expect(episodeIn(d, 0)).toMatchObject({ status: 'CHANGES_REQUESTED' });
    expect(episodeIn(d, 0).revisionStartedAt).not.toBeNull();
    expect(d.revision).toEqual({ episodeCount: 1, bySeason: [{ seasonNumber: 1, episodeNumbers: [1] }] });

    const bell = (await creator.get<Bell>('/notifications?limit=100')).data;
    const notice = bell.find((n) => n.type === 'CONTENT_CHANGES_REQUESTED' && n.payload.episodeId === episodeId(0));
    expect(notice?.body).toContain('giống một ca sĩ có thật');
  });

  it('goes through delivery and review again; the Reviewer can still send content back', async () => {
    const v2 = await deliver(creator, episodeId(0));
    await reviewer.post(
      `/media-assets/${v2.id}/reviews`,
      { decision: 'CHANGES_REQUESTED', comments: 'Mặt mới vẫn còn giống, nhờ làm lại lần nữa.' },
      200,
    );
    // Not releasable until the fixed version passed review, label and compliance again (BR-19).
    await reviewer.post(`/episodes/${episodeId(0)}/publications`, {}, 409);
    expect((await detail()).status).toBe('UNDER_REVISION');
  });

  it('is released again with the fixed version and the movie completes again', async () => {
    await compliantEpisode(reviewer, creator, episodeId(0));
    await reviewer.post(`/episodes/${episodeId(0)}/publications`, {});

    const d = await detail();
    expect(d.status).toBe('COMPLETED');
    expect(episodeIn(d, 0)).toMatchObject({ status: 'PUBLISHED', revisionStartedAt: null });
    expect(d.revision.episodeCount).toBe(0);

    const events = await reviewer.get<{ action: string }[]>(`/projects/${project.id}/events`);
    expect(events.map((e) => e.action)).toContain('PROJECT_UNDER_REVISION');
  });

  it('keeps the movie COMPLETED when an episode is taken down for good', async () => {
    const release = await liveRelease(1);
    await reviewer.post(
      `/publications/${release.id}/unpublish`,
      { mode: 'REMOVAL', reason: 'MANUAL', note: 'Tập này không còn phù hợp, gỡ hẳn.' },
      200,
    );
    const d = await detail();
    expect(episodeIn(d, 1)).toMatchObject({ status: 'UNPUBLISHED', revisionStartedAt: null });
    expect(d.status).toBe('COMPLETED');
  });
});
