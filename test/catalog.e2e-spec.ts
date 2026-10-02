import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Card {
  id: string;
  title: string;
  ageRating: string;
  aiGenerated: boolean;
  genres: { id: string; name: string }[];
}
interface EpisodeView {
  id: string;
  episodeNumber: number;
  availability: string;
  notice: string | null;
  isFreeStarter: boolean;
  coinPrice: number;
  durationSeconds: number | null;
  aiLabel: { labelType: string; labelText: string } | null;
}

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('Public catalog (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let listed: ProjectDetail;
  let unreleased: ProjectDetail;

  /** A Guest: no token at all (BR-07). */
  const guest = async <T>(path: string, status = 200): Promise<T> => {
    const res = await request(app.getHttpServer()).get(`/api${path}`);
    if (res.status !== status) throw new Error(`GET ${path} -> ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const episodeId = (i: number) => episodesOf(listed)[i].id;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    listed = await projectInProduction(reviewer, creator, 4);
    unreleased = await projectInProduction(reviewer, creator, 1);
    await reviewer.patch(`/projects/${listed.id}`, {
      title: `Thành phố không ngủ ${Date.now()}`,
      synopsis: 'Một thám tử AI truy tìm kẻ đánh cắp ký ức.',
      ageRating: 'T16',
    });
    for (let i = 0; i < 4; i += 1) {
      await compliantEpisode(reviewer, creator, episodeId(i));
      await reviewer.patch(`/episodes/${episodeId(i)}/coin-price`, { coinPrice: 10 + i });
      // Episodes 1–3 are out, episode 4 is only scheduled.
      await reviewer.post(`/episodes/${episodeId(i)}/publications`, i < 3 ? {} : { scheduledAt: inHours(24) });
    }
  });

  afterAll(() => app.close());

  it('lists, to a Guest, only movies with a released episode, and only catalog fields', async () => {
    const page = await guest<{ data: (Card & Record<string, unknown>)[] }>('/movies?limit=100');
    const card = page.data.find((m) => m.id === listed.id)!;

    expect(card).toMatchObject({ ageRating: 'T16', aiGenerated: true });
    expect(card.genres.length).toBeGreaterThan(0);
    for (const internal of ['reviewerId', 'creatorId', 'studioName', 'studioEmail', 'ideaDescription', 'status']) {
      expect(card).not.toHaveProperty(internal);
    }
    expect(page.data.some((m) => m.id === unreleased.id)).toBe(false);
    await guest(`/movies/${unreleased.id}`, 404);
    await guest(`/movies/${unreleased.id}/episodes`, 404);
  });

  it('searches and filters by genre', async () => {
    const [genreId] = (await guest<Card>(`/movies/${listed.id}`)).genres.map((g) => g.id);
    const byGenre = await guest<{ data: Card[] }>(`/movies?genreId=${genreId}&limit=100`);
    expect(byGenre.data.some((m) => m.id === listed.id)).toBe(true);

    const bySearch = await guest<{ data: Card[] }>(
      `/movies?search=${encodeURIComponent('Thành phố không ngủ')}&limit=100`,
    );
    expect(bySearch.data.map((m) => m.id)).toContain(listed.id);
    await guest('/movies?genreId=not-a-uuid', 400);
  });

  it('shows released episodes with the free-starter flag, price, length and AI label, never a stream URL', async () => {
    const episodes = await guest<(EpisodeView & Record<string, unknown>)[]>(`/movies/${listed.id}/episodes`);

    expect(episodes.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
    // Two free starter episodes by default (BR-03).
    expect(episodes.map((e) => e.isFreeStarter)).toEqual([true, true, false]);
    expect(episodes[2]).toMatchObject({ availability: 'AVAILABLE', notice: null, coinPrice: 12, durationSeconds: 60 });
    expect(episodes[0].aiLabel).toMatchObject({ labelType: 'AI_GENERATED' });
    for (const internal of ['streamUrl', 'approvedMediaAssetId', 'status', 'dueDate', 'milestoneDate']) {
      expect(episodes[0]).not.toHaveProperty(internal);
    }

    const movie = await guest<{ seasons: { seasonNumber: number; episodeCount: number }[]; episodeCount: number }>(
      `/movies/${listed.id}`,
    );
    expect(movie.seasons).toEqual([{ seasonNumber: 1, title: null, episodeCount: 3 }]);
    expect(movie.episodeCount).toBe(3);
    // The scheduled episode is not out yet.
    await guest(`/episodes/${episodeId(3)}`, 404);
  });

  it('keeps an episode under maintenance listed with the notice (BR-56) and hides one removed for good', async () => {
    const live = async (i: number) =>
      (await reviewer.get<{ id: string; publishedAt: string | null }[]>(`/episodes/${episodeId(i)}/publications`)).find(
        (p) => p.publishedAt,
      )!;
    await reviewer.post(
      `/publications/${(await live(1)).id}/unpublish`,
      { mode: 'REVISION', reason: 'COMPLIANCE_ISSUE', note: 'Cảnh cuối cần làm lại phụ đề.' },
      200,
    );
    await reviewer.post(
      `/publications/${(await live(2)).id}/unpublish`,
      { mode: 'REMOVAL', reason: 'MANUAL', note: 'Gỡ hẳn tập này.' },
      200,
    );

    const episodes = await guest<EpisodeView[]>(`/movies/${listed.id}/episodes`);
    expect(episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
    expect(episodes[1]).toMatchObject({
      availability: 'UNDER_REVISION',
      notice: 'Tập đang được bảo trì / sửa đổi nội dung',
      aiLabel: null,
      durationSeconds: null,
    });
    expect(await guest<EpisodeView>(`/episodes/${episodeId(1)}`)).toMatchObject({ availability: 'UNDER_REVISION' });
    await guest(`/episodes/${episodeId(2)}`, 404);
  });
});
