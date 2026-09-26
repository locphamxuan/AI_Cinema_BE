import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Actor, bootApp, signIn } from './support/api';
import type { EpisodePackage, Movie, Page, Project, Row, Scene } from './support/types';

const MANUAL_CHECKS = ['CONTENT_POLICY', 'LEGAL', 'COPYRIGHT', 'WATERMARK', 'REAL_PERSON_LIKENESS'];
// Unique per run, so the suite can run again on the same database.
const RUN = Date.now().toString(36);
const day = (offset: number) => new Date(Date.UTC(2026, 9, 1 + offset)).toISOString();

/**
 * MF-1 end to end, in the order the workspace calls the API: the Reviewer sets
 * up a project, the Creator plans an episode, the Reviewer approves it and grants
 * tokens, the Creator produces and hands in the cut, the Reviewer sends it back
 * once, then labels, checks and approves it, and finally publishes it.
 */
describe('MF-1 production workflow (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let creator: Actor;
  let otherCreator: Actor;

  let projectId: string;
  let planId: string;
  let sceneIds: string[];
  let packageId: string;
  let policyId: string;

  const plan = async () => {
    const project = await reviewer.get<Project>(`/production-projects/${projectId}`);
    return project.productionPlans.find((p) => p.id === planId)!;
  };

  beforeAll(async () => {
    app = await bootApp();
    reviewer = await signIn(app, 'reviewer01@aicinema.com');
    creator = await signIn(app, 'creator01@aicinema.com');
    otherCreator = await signIn(app, 'creator02@aicinema.com');
  });

  afterAll(() => app.close());

  describe('accounts', () => {
    it('signs a public registration up as a viewer even when it claims a staff role', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: `intruder-${RUN}@example.com`, password: 'Intruder@123', fullName: 'Intruder', role: 'ADMIN' });
      expect(res.status).toBe(201);
      expect((res.body as { user: { role: string } }).user.role).toBe('MEMBER');
    });
  });

  it('lets the Reviewer create a two-language project assigned to the Creator', async () => {
    // The workspace offers only Creators as assignees.
    const creators = await reviewer.get<Page<{ id: string; role: string }>>('/users?filter.role=$eq:CONTENT_CREATOR');
    expect(creators.data.map((u) => u.id)).toContain(creator.id);
    expect(creators.data.every((u) => u.role === 'CONTENT_CREATOR')).toBe(true);

    const genres = await reviewer.get<Page<Row>>('/genres?limit=5');
    const project = await reviewer.post<Project>('/production-projects', {
      title: `E2E Saigon 2077 ${RUN}`,
      description: 'Phim AI kiểm thử',
      contentType: 'SERIES',
      assignedCreatorId: creator.id,
      genreIds: [genres.data[0].id],
      subtitleLanguages: ['vi', 'en'],
      episodes: [
        { seasonNumber: 1, targetDurationSeconds: 900 },
        { seasonNumber: 1, targetDurationSeconds: 900 },
        { seasonNumber: 1, targetDurationSeconds: 900 },
      ],
      totalAiQuotaBudget: 5000,
      productionStartDate: day(0),
      deadline: day(90),
      plannedReleaseDate: day(120),
      milestones: [{ title: 'Kịch bản', startDate: day(0), targetDate: day(30) }],
    });

    projectId = project.id;
    planId = project.productionPlans[0].id;
    expect(project.productionPlans).toHaveLength(3);
    expect(project.status).toBe('DRAFT');
  });

  it('keeps the project private to its assigned Creator', async () => {
    await creator.get(`/production-projects/${projectId}`);
    await otherCreator.get(`/production-projects/${projectId}`, 403);
    await otherCreator.post(
      `/production-plans/${planId}/scenes`,
      { sceneNumber: 1, title: 'x', targetDurationSeconds: 10 },
      403,
    );
  });

  it('lets the Creator plan scenes and submit the plan with a new duration', async () => {
    const scenes: { id: string; description: string }[] = [];
    for (const n of [1, 2]) {
      scenes.push(
        await creator.post<Scene>(`/production-plans/${planId}/scenes`, {
          sceneNumber: n,
          title: `Cảnh ${n}`,
          description: `Mô tả cảnh ${n}`,
          scriptText: `Mô tả cảnh ${n}`,
          targetDurationSeconds: 300,
          estimatedTokens: 200,
        }),
      );
    }
    sceneIds = scenes.map((s) => s.id);

    const submitted = await creator.post(`/production-plans/${planId}/submit`, {
      scriptText: 'Kịch bản tổng thể',
      productionApproach: 'Cinematic',
      targetDurationSeconds: 600,
      estimatedAiResourceUsage: 400,
      scenes: scenes.map((s) => ({ sceneId: s.id, scriptText: s.description })),
    });
    expect(submitted.status).toBe('SUBMITTED');
  });

  it('refuses tokens and production before the plan is approved', async () => {
    await creator.post(
      `/production-plans/${planId}/quota-allocations`,
      { allocationType: 'INITIAL', allocatedAmount: 1 },
      403,
    );
    await creator.post(`/production-plans/${planId}/quota-requests`, { requestedAmount: 100, reason: 'x' }, 409);
  });

  it('approves the plan field by field, then grants the initial quota', async () => {
    const rows = await reviewer.post<Row[]>(`/production-plans/${planId}/plan-reviews`);
    expect(rows).toHaveLength(sceneIds.length + 3);
    for (const row of rows) await reviewer.patch(`/plan-reviews/${row.id}`, { decision: 'APPROVED' });
    expect((await plan()).status).toBe('APPROVED');

    await reviewer.post(`/production-plans/${planId}/quota-allocations`, {
      allocationType: 'INITIAL',
      allocatedAmount: 600,
    });
    const project = await reviewer.get<Project>(`/production-projects/${projectId}`);
    expect(Number(project.remainingAiQuotaBudget)).toBe(4400);
    // The first quota starts production.
    expect(project.status).toBe('ACTIVE');
  });

  it('lets the Creator generate a video for every scene against the quota', async () => {
    for (const sceneId of sceneIds) {
      const job = await creator.post(`/production-plans/${planId}/generation-jobs`, {
        jobType: 'SCENE_VIDEO',
        prompt: 'Rượt đuổi dưới mưa neon',
        sceneId,
      });
      const done = await creator.post(`/generation-jobs/${job.id}/run`);
      expect(done.status).toBe('COMPLETED');
    }
    const [allocation] = (await plan()).quotaAllocations;
    expect(Number(allocation.remainingAmount)).toBeLessThan(600);
  });

  it('grants a top-up the Creator asks for, once, from the project budget', async () => {
    const asked = await creator.post(`/production-plans/${planId}/quota-requests`, {
      requestedAmount: 800,
      reason: 'Sinh lại cảnh 2',
    });
    await creator.post(`/production-plans/${planId}/quota-requests`, { requestedAmount: 1, reason: 'x' }, 409);
    await creator.post(`/quota-requests/${asked.id}/approve`, {}, 403);

    const approved = await reviewer.post<Row>(`/quota-requests/${asked.id}/approve`, {
      approvedAmount: 500,
      note: 'Cấp một phần',
    });
    expect(approved).toMatchObject({ status: 'APPROVED', quotaAllocation: { allocationType: 'TOP_UP' } });
    await reviewer.post(`/quota-requests/${asked.id}/reject`, { note: 'x' }, 409);

    const { quotaRequests, quotaAllocations } = await plan();
    expect(quotaRequests[0]).toMatchObject({ status: 'APPROVED', decisionNote: 'Cấp một phần' });
    expect(quotaAllocations.map((q) => q.allocationType)).toEqual(['INITIAL', 'TOP_UP']);
    const project = await reviewer.get<Project>(`/production-projects/${projectId}`);
    expect(Number(project.remainingAiQuotaBudget)).toBe(3900);
  });

  it('assembles the cut with a subtitle track per language and hands it in', async () => {
    for (const sceneId of sceneIds) await creator.post(`/scenes/${sceneId}/submit`);
    const pkg = await creator.post<EpisodePackage>(`/production-plans/${planId}/episode-packages`);
    packageId = pkg.id;
    expect(pkg.subtitles.map((s) => s.language).sort()).toEqual(['en', 'vi']);
    expect(pkg.streamUrl).toBeTruthy();

    await creator.post(`/episode-packages/${packageId}/submissions`);
    await creator.post(`/episode-packages/${packageId}/submissions`, {}, 409);
    // The cut under audit cannot be swapped by re-assembling.
    await creator.post(`/production-plans/${planId}/episode-packages`, {}, 409);
  });

  it('lets the Reviewer send the cut back before any compliance work', async () => {
    const review = await reviewer.post(`/episode-packages/${packageId}/reviews`);
    const again = await reviewer.post(`/episode-packages/${packageId}/reviews`);
    expect(again.id).toBe(review.id);

    const decided = await reviewer.patch(`/reviews/${review.id}`, {
      decision: 'CHANGES_REQUESTED',
      rejectionReason: 'Cảnh 2 thiếu ánh sáng',
    });
    expect(decided.status).toBe('CHANGES_REQUESTED');
    await reviewer.post(`/episode-packages/${packageId}/reviews`, {}, 409);
  });

  it('lets the Creator regenerate, re-assemble and hand in a new version', async () => {
    const [job] = await creator.get<Row[]>(`/production-plans/${planId}/generation-jobs`);
    const retry = await creator.post(`/generation-jobs/${job.id}/retry`, { prompt: 'Thêm ánh sáng' });
    await creator.post(`/generation-jobs/${retry.id}/run`);

    const previous = packageId;
    const pkg = await creator.post<EpisodePackage>(`/production-plans/${planId}/episode-packages`);
    packageId = pkg.id;
    expect(pkg.packageVersion).toBe(2);
    await creator.post(`/episode-packages/${previous}/submissions`, {}, 409);
    await creator.post(`/episode-packages/${packageId}/submissions`);
  });

  it('approves the cut only once it is labelled and every compliance check passed (BR-42)', async () => {
    const review = await reviewer.post(`/episode-packages/${packageId}/reviews`);
    await reviewer.patch(`/reviews/${review.id}`, { decision: 'APPROVED' }, 409);

    const policies = await reviewer.get<Page<{ id: string; isActive: boolean }>>('/policies');
    policyId = policies.data.find((p) => p.isActive)!.id;
    await reviewer.post(`/episode-packages/${packageId}/ai-content-labels`, {
      labelType: 'AI_GENERATED',
      labelText: 'Nội dung được tạo bằng AI',
      displayLocation: 'FULL_DURATION',
      policyId,
    });
    const compliance = await reviewer.post<{ verdict: string }>(`/episode-packages/${packageId}/compliance-reviews`, {
      policyId,
      checks: MANUAL_CHECKS.map((checkType) => ({ checkType, result: 'PASS' })),
    });
    expect(compliance.verdict).toBe('PASS');

    const approved = await reviewer.patch(`/reviews/${review.id}`, { decision: 'APPROVED' });
    expect(approved.status).toBe('APPROVED');
    await creator.post(`/production-plans/${planId}/episode-packages`, {}, 409);
  });

  it('publishes the approved episode to the public catalog', async () => {
    const movie = await reviewer.post<Movie>(`/episode-packages/${packageId}/catalog`);
    const episode = movie.episodes.find((e) => e.currentPackageId === packageId)!;

    const publication = await reviewer.post(`/episodes/${episode.id}/publications`, { packageId });
    await reviewer.post(`/publications/${publication.id}/publish`);

    const listed = await request(app.getHttpServer()).get(`/api/movies/${movie.id}`).expect(200);
    expect((listed.body as Movie).episodes.map((e) => e.id)).toEqual([episode.id]);

    const [published] = (await plan()).episodePackages;
    expect(published.currentForEpisode?.productionStatus).toBe('PUBLISHED');
  });

  it('keeps the project ACTIVE while episodes remain unpublished', async () => {
    const project = await reviewer.get<Project>(`/production-projects/${projectId}`);
    expect(project.status).toBe('ACTIVE');
  });

  it('records the production events of the whole flow (§4.1.4)', async () => {
    const events = await reviewer.get<{ action: string; actorType: string }[]>(
      `/production-projects/${projectId}/events`,
    );
    const actions = events.map((e) => e.action);

    const expected = [
      'PROJECT_CREATED',
      'PRODUCTION_PLAN_SUBMITTED',
      'PRODUCTION_PLAN_APPROVED',
      'EPISODE_QUOTA_ALLOCATED',
    ];
    expected.push('GENERATION_COMPLETED', 'EPISODE_SUBMITTED', 'CONTENT_CHANGES_REQUESTED', 'EPISODE_PUBLISHED');
    expect(actions).toEqual(expect.arrayContaining(expected));
    expect(events.find((e) => e.action === 'GENERATION_COMPLETED')?.actorType).toBe('SYSTEM');
  });

  it('moves milestones on the clock and lets the Creator only note results', async () => {
    const project = await creator.get<Project>(`/production-projects/${projectId}`);
    const [milestone] = project.milestones;
    const path = `/milestones/${milestone.id}`;

    await creator.patch(path, { status: 'IN_PROGRESS' }, 403);
    await creator.patch(path, { targetDate: day(60) }, 403);
    const noted = await creator.patch<{ resultText: string }>(path, { resultText: 'Xong kịch bản' });
    expect(noted.resultText).toBe('Xong kịch bản');
    await reviewer.patch(path, { status: 'IN_PROGRESS' }, 400);
    await creator.get('/milestones/not-a-uuid', 400);
  });
});
