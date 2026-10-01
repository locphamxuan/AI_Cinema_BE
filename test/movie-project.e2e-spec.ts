import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';

interface Project extends Row {
  status: string;
  productionFeeTokens: number;
  openChangeRequests: number;
  seasons: { seasonNumber: number; episodes: { id: string; episodeNumber: number; status: string }[] }[];
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

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

  it('creates a project whose episodes are numbered across seasons (BR-37)', async () => {
    const project = await reviewer.post<Project>('/projects', {
      title: 'Căn Hộ Số 13',
      ideaDescription: 'Phim kinh dị tâm lý về một căn hộ không ai dám thuê.',
      genreIds: [genreId],
      seasons: [
        {
          title: 'Mùa 1',
          episodes: [
            { title: 'Tập 1', targetDurationSeconds: 900 },
            { title: 'Tập 2', targetDurationSeconds: 2700 },
          ],
        },
        { episodes: [{ title: 'Tập 3', targetDurationSeconds: 600 }] },
      ],
    });
    projectId = project.id;
    expect(project.status).toBe('DRAFT');
    expect(project.seasons.map((s) => s.episodes.map((e) => e.episodeNumber))).toEqual([[1, 2], [3]]);
  });

  it('keeps projects private to their Reviewer and away from Creators who are not assigned', async () => {
    await creator.post('/projects', { title: 'x' }, 403);
    await otherReviewer.get(`/projects/${projectId}`, 404);
    await creator.get(`/projects/${projectId}`, 404);
    await otherReviewer.post(`/projects/${projectId}/fee/entries`, { entryType: 'INITIAL', amountTokens: 1 }, 404);
  });

  it('assigns the Creator only once the production fee is allocated (BR-12)', async () => {
    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: creator.id }, 409);
    await reviewer.post(`/projects/${projectId}/fee/entries`, { entryType: 'INITIAL', amountTokens: 50000 });
    await reviewer.post(`/projects/${projectId}/fee/entries`, { entryType: 'INITIAL', amountTokens: 10 }, 409);
    await reviewer.post(`/projects/${projectId}/fee/entries`, { entryType: 'TOP_UP', amountTokens: 5000 }, 400);
    await reviewer.post(
      `/projects/${projectId}/fee/entries`,
      { entryType: 'CORRECTION', amountTokens: -50000, reason: 'typo' },
      400,
    );
    const fee = await reviewer.post<{ totalTokens: number }>(`/projects/${projectId}/fee/entries`, {
      entryType: 'TOP_UP',
      amountTokens: 5000,
      reason: 'Extra VFX',
    });
    expect(fee.totalTokens).toBe(55000);

    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: otherReviewer.id }, 400);
    await reviewer.post(`/projects/${projectId}/assign`, { creatorId: creator.id }, 204);
    const project = await creator.get<Project>(`/projects/${projectId}`);
    expect(project).toMatchObject({ status: 'ASSIGNED', productionFeeTokens: 55000 });

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
  });

  it('lets the Admin read and propose but never edit (BR-55)', async () => {
    const all = await admin.get<{ data: Row[] }>('/projects?limit=100');
    expect(all.data.map((p) => p.id)).toContain(projectId);
    await admin.patch(`/projects/${projectId}`, { title: 'Hijacked' }, 403);

    const proposal = await admin.post(`/projects/${projectId}/change-requests`, {
      content: 'Tập 2 nên ngắn lại 15 phút.',
    });
    expect((await reviewer.get<Project>(`/projects/${projectId}`)).openChangeRequests).toBe(1);

    await reviewer.post(`/change-requests/${proposal.id}/reject`, {}, 400);
    await reviewer.post(`/change-requests/${proposal.id}/reject`, { response: 'Studio đã quay xong.' });
    await reviewer.post(`/change-requests/${proposal.id}/accept`, {}, 409);
    const answers = await admin.get<{ data: { type: string }[] }>('/notifications');
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
