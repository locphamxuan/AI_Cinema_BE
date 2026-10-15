import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { inDays, newStudio } from './support/projects';

interface Project extends Row {
  status: string;
  productionFeeTokens: number;
  openChangeRequests: number;
  seasons: {
    id: string;
    seasonNumber: number;
    releaseStartDate: string | null;
    releaseEndDate: string | null;
    episodes: {
      id: string;
      episodeNumber: number;
      status: string;
      deliveryDeadline: string | null;
      expectedReleaseDate: string | null;
    }[];
  }[];
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const PROOF = { field: 'proof', name: 'bao-gia.pdf', content: PDF };

describe('Movie projects (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let otherReviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let genreId: string;
  let projectId: string;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, otherReviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    genreId = (await reviewer.get<{ data: Row[] }>('/genres?limit=1')).data[0].id;
  });

  afterAll(() => app.close());

  const newProject = (episodes: object[]) => ({
    title: 'Căn Hộ Số 13',
    ideaDescription: 'Phim kinh dị tâm lý về một căn hộ không ai dám thuê.',
    genreIds: [genreId],
    seasons: [
      {
        title: 'Mùa 1',
        episodeProductionCost: 10_000,
        releaseStartDate: inDays(40),
        releaseEndDate: inDays(80),
        episodes: episodes.slice(0, 2),
      },
      { episodeProductionCost: 10_000, episodes: episodes.slice(2) },
    ],
  });

  it('creates a project whose episodes are numbered across seasons (BR-37)', async () => {
    const project = await reviewer.post<Project>(
      '/projects',
      newProject([
        { title: 'Tập 1', targetDurationSeconds: 900, deliveryDeadline: inDays(20), expectedReleaseDate: inDays(45) },
        { title: 'Tập 2', targetDurationSeconds: 2700, deliveryDeadline: inDays(27) },
        { title: 'Tập 3', targetDurationSeconds: 600, deliveryDeadline: inDays(34) },
      ]),
    );
    projectId = project.id;
    expect(project.status).toBe('DRAFT');
    expect(project.seasons.map((s) => s.episodes.map((e) => e.episodeNumber))).toEqual([[1, 2], [3]]);
    expect(project.seasons[0].episodes[0].deliveryDeadline).toContain(inDays(20));
    expect(project.seasons[0].releaseEndDate).toContain(inDays(80));
  });

  it('adds a genre the list does not have yet when the project names it', async () => {
    const name = `Thể loại mới ${Date.now()}`;
    const project = await reviewer.post<Project & { genres: Row[]; synopsis: string; releaseYear: number }>(
      '/projects',
      {
        ...newProject(
          [1, 2, 3].map((n) => ({ title: `Tập ${n}`, targetDurationSeconds: 900, deliveryDeadline: inDays(20 + n) })),
        ),
        genreNames: [name],
        synopsis: 'Tóm tắt cho người xem.',
        releaseYear: 2026,
        ageRating: 'T16',
      },
    );
    expect(project.genres.map((g) => g.name)).toContain(name);
    expect(project).toMatchObject({ synopsis: 'Tóm tắt cho người xem.', releaseYear: 2026, ageRating: 'T16' });
    const listed = await reviewer.get<{ data: Row[] }>(`/genres?search=${encodeURIComponent(name)}`);
    expect(listed.data).toHaveLength(1);
  });

  it('needs a delivery deadline, today or later, for every episode', async () => {
    const episode = { title: 'Tập 1', targetDurationSeconds: 900 };
    await reviewer.post('/projects', newProject([episode]), 400);
    await reviewer.post('/projects', newProject([{ ...episode, deliveryDeadline: '2020-01-01' }]), 400);
    await reviewer.post(`/projects/${projectId}/seasons`, { episodes: [episode] }, 400);

    const [first] = (await reviewer.get<Project>(`/projects/${projectId}`)).seasons[0].episodes;
    await reviewer.patch(`/episodes/${first.id}`, { deliveryDeadline: '2020-01-01' }, 400);
    const moved = await reviewer.patch<{ deliveryDeadline: string }>(`/episodes/${first.id}`, {
      deliveryDeadline: inDays(21),
    });
    expect(moved.deliveryDeadline).toContain(inDays(21));
    await creator.patch(`/episodes/${first.id}`, { deliveryDeadline: inDays(40) }, 403);
  });

  it('keeps the expected release date inside the season window and after the deadline (BR-60)', async () => {
    const [season] = (await reviewer.get<Project>(`/projects/${projectId}`)).seasons;
    const [first, second] = season.episodes;
    await reviewer.patch(`/episodes/${first.id}`, { expectedReleaseDate: inDays(10) }, 400);
    await reviewer.patch(`/episodes/${first.id}`, { expectedReleaseDate: inDays(100) }, 400);
    await reviewer.patch(`/episodes/${first.id}`, { expectedReleaseDate: inDays(50) });
    await reviewer.patch(`/episodes/${second.id}`, { expectedReleaseDate: inDays(55) });

    await reviewer.patch(`/seasons/${season.id}`, { releaseEndDate: inDays(52) }, 400);
    await reviewer.patch(`/episodes/${second.id}`, { expectedReleaseDate: null });
    const shorter = await reviewer.patch<{ releaseEndDate: string }>(`/seasons/${season.id}`, {
      releaseEndDate: inDays(52),
    });
    expect(shorter.releaseEndDate).toContain(inDays(52));
    await reviewer.patch(`/seasons/${season.id}`, { releaseStartDate: inDays(60) }, 400);
  });

  it('gives a project one active studio from the catalog (BR-59)', async () => {
    const studio = await newStudio(reviewer);
    await reviewer.patch(`/projects/${projectId}`, { studioId: '00000000-0000-4000-8000-000000000000' }, 400);
    await reviewer.patch(`/studios/${studio.id}`, { isActive: false });
    await reviewer.patch(`/projects/${projectId}`, { studioId: studio.id }, 409);
    await reviewer.patch(`/studios/${studio.id}`, { isActive: true });
    const updated = await reviewer.patch<{ studio: { id: string } }>(`/projects/${projectId}`, { studioId: studio.id });
    expect(updated.studio.id).toBe(studio.id);
  });

  it('keeps projects private to their Reviewer and away from Creators who are not assigned', async () => {
    await creator.post('/projects', { title: 'x' }, 403);
    await otherReviewer.get(`/projects/${projectId}`, 404);
    await creator.get(`/projects/${projectId}`, 404);
    const [season] = (await reviewer.get<Project>(`/projects/${projectId}`)).seasons;
    await otherReviewer.post(`/projects/${projectId}/fee/entries`, { entryType: 'INITIAL', seasonId: season.id }, 404);
  });

  it('assigns the Creator only once every season fee is allocated (BR-12, BR-46)', async () => {
    const [first, second] = (await reviewer.get<Project>(`/projects/${projectId}`)).seasons;
    const fee = (body: object, status?: number) =>
      reviewer.post<{ totalTokens: number; seasons: Record<string, number>[] }>(
        `/projects/${projectId}/fee/entries`,
        body,
        status,
      );
    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: creator.id }, 409);
    await fee({ entryType: 'INITIAL' }, 400);
    // Price of one episode × 2 episodes; the amount a client sends is ignored.
    expect((await fee({ entryType: 'INITIAL', seasonId: first.id, amountTokens: 1 })).totalTokens).toBe(20_000);
    await fee({ entryType: 'INITIAL', seasonId: first.id }, 409);
    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: creator.id }, 409);

    await fee({ entryType: 'TOP_UP', amountTokens: 5000 }, 400);
    await fee({ entryType: 'CORRECTION', amountTokens: -50_000, reason: 'typo' }, 400);
    expect((await fee({ entryType: 'INITIAL', seasonId: second.id })).totalTokens).toBe(30_000);
    const topped = await fee({
      entryType: 'TOP_UP',
      seasonId: first.id,
      amountTokens: 5000,
      reason: 'Extra VFX',
    });
    expect(topped.totalTokens).toBe(35_000);
    expect(topped.seasons[0]).toMatchObject({ baselineTokens: 20_000, supplementTokens: 5000, missingTokens: 0 });

    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: otherReviewer.id }, 400);
    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: creator.id }, 204);
    const project = await creator.get<Project>(`/projects/${projectId}`);
    expect(project).toMatchObject({ status: 'ASSIGNED', productionFeeTokens: 35_000 });

    const bell = await creator.get<{ data: { type: string }[] }>('/notifications');
    expect(bell.data.map((n) => n.type)).toContain('PROJECT_ASSIGNED');
  });

  it('versions idea files and checks their content, not their name', async () => {
    const file = { field: 'file', name: 'kich-ban.pdf', content: PDF };
    const first = await reviewer.upload<{ version: number }>(`/projects/${projectId}/idea-files`, file);
    const second = await reviewer.upload<{ id: string; version: number }>(`/projects/${projectId}/idea-files`, file);
    expect([first.version, second.version]).toEqual([1, 2]);

    const fake = { field: 'file', name: 'virus.pdf', content: Buffer.from('MZ not a pdf') };
    await reviewer.upload(`/projects/${projectId}/idea-files`, fake, {}, 400);

    const download = await creator.download(`/projects/${projectId}/idea-files/${second.id}/content`);
    expect(download.body.equals(PDF)).toBe(true);
    expect(download.type).toContain('application/pdf');

    const script = Buffer.from('Cảnh 1: Nhân vật bước vào rạp phim.\n', 'utf8');
    const textFile = await reviewer.upload<{ id: string; mimeType: string }>(`/projects/${projectId}/idea-files`, {
      field: 'file',
      name: 'kich-ban.txt',
      content: script,
    });
    expect(textFile.mimeType).toBe('text/plain');
    const textDownload = await creator.download(`/projects/${projectId}/idea-files/${textFile.id}/content`);
    expect(textDownload.body.equals(script)).toBe(true);
    expect(textDownload.type).toContain('text/plain');

    await reviewer.upload(
      `/projects/${projectId}/idea-files`,
      { field: 'file', name: 'binary.txt', content: Buffer.from([0x4d, 0x5a, 0x00, 0x01]) },
      {},
      400,
    );
  });

  it('lets the Admin read every project but never edit one (BR-55)', async () => {
    const all = await admin.get<{ data: (Row & { lastActivityAt: string })[] }>('/projects?limit=100');
    expect(all.data.map((p) => p.id)).toContain(projectId);
    // "Cập nhật lần cuối" follows the content events, which are newer than the project row itself.
    const mine = all.data.find((p) => p.id === projectId)!;
    expect(new Date(mine.lastActivityAt).getTime()).toBeGreaterThan(Date.parse(mine.updatedAt as string));
    await admin.patch(`/projects/${projectId}`, { title: 'Hijacked' }, 403);
    await admin.post(
      `/projects/${projectId}/change-requests`,
      { content: 'Tập 2 nên ngắn lại.', reason: 'x'.repeat(8) },
      403,
    );
  });

  it('sends a change request to the Admin, who approves a budget supplement into the Reviewer budget', async () => {
    const path = `/projects/${projectId}/change-requests`;
    const body = { content: 'Tập 2 nên ngắn lại 15 phút.', reason: 'Khán giả thích tập ngắn.' };
    const plain = await reviewer.post<Row & { status: string }>(path, body);
    expect(plain.status).toBe('OPEN');
    expect((await reviewer.get<Project>(`/projects/${projectId}`)).openChangeRequests).toBe(1);
    await otherReviewer.post(path, body, 404);

    await creator.upload(path, [], { ...body, requestType: 'BUDGET_SUPPLEMENT' }, 400);
    await creator.upload(path, PROOF, { ...body, requestType: 'BUDGET_SUPPLEMENT' }, 400);
    await creator.upload(path, PROOF, { ...body, requestedTokens: '100' }, 400);
    const supplement = await creator.upload<Row>(path, PROOF, {
      ...body,
      content: 'Studio báo giá lại, cần thêm Token.',
      requestType: 'BUDGET_SUPPLEMENT',
      requestedTokens: '12000',
    });

    const inbox = await admin.get<{ id: string }[]>('/change-requests?status=OPEN');
    expect(inbox.map((r) => r.id)).toEqual(expect.arrayContaining([plain.id, supplement.id]));
    await reviewer.get('/change-requests', 403);
    const proof = await admin.download(`/change-requests/${supplement.id}/proof`);
    expect(proof.body.equals(PDF)).toBe(true);

    await admin.post(`/change-requests/${plain.id}/reject`, {}, 400);
    await reviewer.post(`/change-requests/${plain.id}/reject`, { response: 'Không phải việc của tôi.' }, 403);
    await admin.post(`/change-requests/${plain.id}/reject`, { response: 'Studio đã quay xong.' });
    await admin.post(`/change-requests/${plain.id}/approve`, {}, 409);

    const before = (await reviewer.get<{ balanceTokens: number }>('/reviewer-tokens/me')).balanceTokens;
    const approved = await admin.post<{ status: string }>(`/change-requests/${supplement.id}/approve`, {});
    expect(approved.status).toBe('APPROVED');
    const after = (await reviewer.get<{ balanceTokens: number }>('/reviewer-tokens/me')).balanceTokens;
    expect(after - before).toBe(12_000);

    const answers = await creator.get<{ data: { type: string }[] }>('/notifications');
    expect(answers.data.map((n) => n.type)).toContain('PROJECT_CHANGE_RESOLVED');
  });

  it('records every step as a content event', async () => {
    const events = await reviewer.get<{ action: string }[]>(`/projects/${projectId}/events`);
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'PROJECT_CREATED',
        'FEE_ALLOCATED',
        'FEE_TOPPED_UP',
        'PROJECT_ASSIGNED',
        'IDEA_FILE_UPLOADED',
      ]),
    );
  });

  it('cancels a project with a reason, once (BR-39)', async () => {
    await reviewer.post(`/projects/${projectId}/cancel`, { reason: '' }, 400);
    await reviewer.post(`/projects/${projectId}/cancel`, { reason: 'Studio không nhận dự án.' }, 204);
    await reviewer.post(`/projects/${projectId}/cancel`, { reason: 'Again please.' }, 409);
    expect((await reviewer.get<Project>(`/projects/${projectId}`)).status).toBe('CANCELLED');
  });
});
