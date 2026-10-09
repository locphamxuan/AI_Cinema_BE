import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, signIn } from './support/api';
import { deliver } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

interface Sheet {
  id: string;
  version: number;
  proposedLabelType: string;
  aiDisclosure: { aiTools: string[] };
  isApprovedVersion: boolean;
  episode: { status: string };
  durationCheck: { targetSeconds: number; actualSeconds: number; warning: boolean };
  contentReviews: { decision: string; comments: string | null }[];
  aiContentLabel: { labelType: string; labelText: string; displayLocation: string; policy: { name: string } } | null;
  complianceChecks: { checkType: string; result: string; failureReason: string | null }[];
}

type Bell = { data: { type: string; body: string; payload: { mediaAssetId: string } }[] };

const LABEL = { labelType: 'AI_GENERATED', labelText: 'Phim được tạo bằng trí tuệ nhân tạo (AI)' };
const ALL_CLEAR = {
  decree142Notice: { result: 'PASS' },
  contentSafety: { result: 'PASS' },
  depictsRealPersonOrEvent: false,
};

describe('Content review, AI label and compliance (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let otherReviewer: Actor;
  let creator: Actor;
  let project: ProjectDetail;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, otherReviewer, creator] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 2);
  });

  afterAll(() => app.close());

  const episodeId = (i: number) => episodesOf(project)[i].id;
  const creatorBell = async () => (await creator.get<Bell>('/notifications?limit=100')).data;

  it('shows the Reviewer the disclosure and how far the length is from the target (BR-31)', async () => {
    const v1 = await deliver(creator, episodeId(0));
    const sheet = await reviewer.get<Sheet>(`/media-assets/${v1.id}/review-sheet`);

    expect(sheet).toMatchObject({ version: 1, proposedLabelType: 'AI_GENERATED', isApprovedVersion: false });
    expect(sheet.aiDisclosure.aiTools).toEqual(['Kling', 'ElevenLabs']);
    // The mocked pipeline reports 60 s against a 15-minute target.
    expect(sheet.durationCheck).toEqual({
      targetSeconds: 900,
      actualSeconds: 60,
      deviationSeconds: -840,
      warning: true,
    });
    await otherReviewer.get(`/media-assets/${v1.id}/review-sheet`, 404);
  });

  it('is decided only by the Reviewer in charge; changes need feedback for the studio (BR-18)', async () => {
    const [v1] = await reviewer.get<Sheet[]>(`/episodes/${episodeId(0)}/media`);
    const path = `/media-assets/${v1.id}/reviews`;
    await creator.post(path, { decision: 'APPROVED' }, 403);
    await otherReviewer.post(path, { decision: 'APPROVED' }, 404);
    await reviewer.post(path, { decision: 'CHANGES_REQUESTED' }, 400);

    const sheet = await reviewer.post<Sheet>(
      path,
      { decision: 'CHANGES_REQUESTED', comments: 'Phút 0:30 mặt nhân vật bị méo, nhờ studio làm lại.' },
      200,
    );
    expect(sheet.episode.status).toBe('CHANGES_REQUESTED');
    expect(sheet.contentReviews[0]).toMatchObject({ decision: 'CHANGES_REQUESTED' });
    const notice = (await creatorBell()).find(
      (n) => n.type === 'CONTENT_CHANGES_REQUESTED' && n.payload.mediaAssetId === v1.id,
    );
    expect(notice?.body).toContain('mặt nhân vật bị méo');

    // The version was sent back: it can no longer be approved.
    await reviewer.post(path, { decision: 'APPROVED' }, 409);
  });

  it('reviews only the latest delivery, then approves it', async () => {
    const [v1] = await reviewer.get<Sheet[]>(`/episodes/${episodeId(0)}/media`);
    const v2 = await deliver(creator, episodeId(0));
    expect(v2.version).toBe(2);
    await reviewer.post(`/media-assets/${v1.id}/reviews`, { decision: 'APPROVED' }, 409);

    // Nothing to label or check before the approval.
    await reviewer.post(`/media-assets/${v2.id}/ai-content-labels`, LABEL, 409);
    const sheet = await reviewer.post<Sheet>(`/media-assets/${v2.id}/reviews`, { decision: 'APPROVED' }, 200);
    expect(sheet).toMatchObject({ isApprovedVersion: true, episode: { status: 'APPROVED' } });
    expect((await creatorBell()).some((n) => n.type === 'CONTENT_APPROVED' && n.payload.mediaAssetId === v2.id)).toBe(
      true,
    );
  });

  it('labels the approved version under the Article 44 policy before any compliance check (BR-40)', async () => {
    const [v2] = await reviewer.get<Sheet[]>(`/episodes/${episodeId(0)}/media`);
    await reviewer.post(`/media-assets/${v2.id}/compliance-checks`, ALL_CLEAR, 409);
    await creator.post(`/media-assets/${v2.id}/ai-content-labels`, LABEL, 403);
    await reviewer.post(`/media-assets/${v2.id}/ai-content-labels`, { ...LABEL, labelType: 'MADE_BY_HAND' }, 400);

    const sheet = await reviewer.post<Sheet>(`/media-assets/${v2.id}/ai-content-labels`, LABEL, 200);
    expect(sheet.episode.status).toBe('LABELED');
    expect(sheet.aiContentLabel).toMatchObject({ ...LABEL, displayLocation: 'TOP_RIGHT' });
    expect(sheet.aiContentLabel!.policy.name).toBe('AI-Generated Content Labeling Policy');
  });

  it('sends the version back when a compliance item fails (BR-42)', async () => {
    const [v2] = await reviewer.get<Sheet[]>(`/episodes/${episodeId(0)}/media`);
    await reviewer.post(
      `/media-assets/${v2.id}/compliance-checks`,
      { ...ALL_CLEAR, contentSafety: { result: 'FAIL' } },
      400,
    );
    await reviewer.post(
      `/media-assets/${v2.id}/compliance-checks`,
      { ...ALL_CLEAR, depictsRealPersonOrEvent: true },
      400,
    );
    await reviewer.post(`/media-assets/${v2.id}/compliance-checks`, { depictsRealPersonOrEvent: false }, 400);

    const sheet = await reviewer.post<Sheet>(
      `/media-assets/${v2.id}/compliance-checks`,
      { ...ALL_CLEAR, contentSafety: { result: 'FAIL', failureReason: 'Cảnh bạo lực ở phút 0:40 quá mức.' } },
      200,
    );
    expect(sheet).toMatchObject({ isApprovedVersion: false, episode: { status: 'CHANGES_REQUESTED' } });
    expect(sheet.complianceChecks.find((c) => c.checkType === 'CONTENT_SAFETY')).toMatchObject({
      result: 'FAIL',
      failureReason: 'Cảnh bạo lực ở phút 0:40 quá mức.',
    });
    expect(sheet.contentReviews[0].comments).toContain('Compliance check failed');
  });

  it('passes compliance, and asks for it again when the label changes afterwards', async () => {
    const v1 = await deliver(creator, episodeId(1));
    await reviewer.post(`/media-assets/${v1.id}/reviews`, { decision: 'APPROVED' }, 200);
    await reviewer.post(`/media-assets/${v1.id}/ai-content-labels`, LABEL, 200);

    let sheet = await reviewer.post<Sheet>(`/media-assets/${v1.id}/compliance-checks`, ALL_CLEAR, 200);
    expect(sheet.episode.status).toBe('COMPLIANCE_PASSED');
    expect(sheet.complianceChecks.map((c) => c.result)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);

    sheet = await reviewer.post<Sheet>(
      `/media-assets/${v1.id}/ai-content-labels`,
      { ...LABEL, labelType: 'AI_EDITED', displayLocation: 'INTRO_NOTICE' },
      200,
    );
    expect(sheet.episode.status).toBe('LABELED');
    expect(sheet.complianceChecks.map((c) => c.result)).toEqual(['PENDING', 'PENDING', 'PENDING', 'PENDING']);

    sheet = await reviewer.post<Sheet>(`/media-assets/${v1.id}/compliance-checks`, ALL_CLEAR, 200);
    expect(sheet.episode.status).toBe('COMPLIANCE_PASSED');

    // Until it is scheduled, the Reviewer can still send it back.
    sheet = await reviewer.post<Sheet>(
      `/media-assets/${v1.id}/reviews`,
      { decision: 'CHANGES_REQUESTED', comments: 'Phát hiện lỗi phụ đề ở cuối tập.' },
      200,
    );
    expect(sheet.episode.status).toBe('CHANGES_REQUESTED');
  });

  it('logs every decision as a content event', async () => {
    const events = await reviewer.get<{ action: string }[]>(`/projects/${project.id}/events`);
    const actions = new Set(events.map((e) => e.action));
    for (const action of [
      'CONTENT_CHANGES_REQUESTED',
      'CONTENT_APPROVED',
      'AI_LABEL_APPLIED',
      'COMPLIANCE_FAILED',
      'COMPLIANCE_PASSED',
    ]) {
      expect(actions).toContain(action);
    }
  });
});
