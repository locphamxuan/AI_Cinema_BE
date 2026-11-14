import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { HANDOFF_FEE_VND, PROJECT_BUDGET_VND, type ProjectDetail, projectInProduction } from './support/projects';

interface Ledger {
  budgetVnd: number;
  committedVnd: number;
  remainingVnd: number;
  entries: { entryType: string; amountVnd: number; reason: string | null; request: { id: string } | null }[];
}

interface CostRequest extends Row {
  status: string;
  requestedVnd: number;
  grantedVnd: number | null;
  handoff: { id: string } | null;
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const QUOTE = { field: 'proof', name: 'bao-gia-studio.pdf', content: PDF };

describe('Production cost in VND (e2e)', () => {
  let app: INestApplication<App>;
  let reviewer: Actor;
  let otherReviewer: Actor;
  let creator: Actor;
  let admin: Actor;
  let project: ProjectDetail;
  let handoffId: string;

  beforeAll(async () => {
    app = await bootApp();
    [reviewer, otherReviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'reviewer02@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 1);
    handoffId = (await reviewer.get<Row[]>(`/projects/${project.id}/handoffs`))[0].id;
  });

  afterAll(() => app.close());

  const ledger = () => reviewer.get<Ledger>(`/projects/${project.id}/costs`);

  it('commits the offered fee of the hand-off against the budget', async () => {
    expect(await ledger()).toMatchObject({
      budgetVnd: PROJECT_BUDGET_VND,
      committedVnd: HANDOFF_FEE_VND,
      remainingVnd: PROJECT_BUDGET_VND - HANDOFF_FEE_VND,
    });
  });

  it('lets only the Admin set the budget once and correct it, never below what is committed', async () => {
    const entries = `/projects/${project.id}/costs/entries`;
    await admin.post(entries, { entryType: 'BUDGET', amountVnd: 1000 }, 409);
    await admin.post(entries, { entryType: 'ADDITIONAL', amountVnd: 1000, reason: 'x' }, 400);
    await admin.post(entries, { entryType: 'CORRECTION', amountVnd: -1000 }, 400);
    await admin.post(entries, { entryType: 'CORRECTION', amountVnd: -70_000_000, reason: 'Cắt giảm' }, 400);
    await reviewer.post(entries, { entryType: 'CORRECTION', amountVnd: 1000, reason: 'x' }, 403);

    const corrected = await admin.post<Ledger>(entries, {
      entryType: 'CORRECTION',
      amountVnd: -10_000_000,
      reason: 'Bỏ một tập khỏi kế hoạch.',
    });
    expect(corrected).toMatchObject({ budgetVnd: 90_000_000, remainingVnd: 50_000_000 });
    const bell = await reviewer.get<{ data: { type: string }[] }>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('COST_BUDGET_CHANGED');
  });

  it('lets the project Reviewer ask the Admin for more, with the studio quote, one request at a time', async () => {
    const path = `/projects/${project.id}/cost-requests`;
    const ask = { requestedVnd: '30000000', studioQuoteVnd: '80000000', handoffId, reason: 'Studio đòi 80 triệu.' };
    await reviewer.upload(path, [], ask, 400);
    await reviewer.upload(path, QUOTE, { ...ask, requestedVnd: '30000500' }, 400);
    await creator.upload(path, QUOTE, ask, 403);
    await otherReviewer.upload(path, QUOTE, ask, 404);

    const request = await reviewer.upload<CostRequest>(path, QUOTE, ask);
    expect(request).toMatchObject({ status: 'OPEN', requestedVnd: 30_000_000, handoff: { id: handoffId } });
    await reviewer.upload(path, QUOTE, ask, 409);

    const inbox = await admin.get<{ data: CostRequest[] }>('/cost-requests?status=OPEN');
    expect(inbox.data.map((r) => r.id)).toContain(request.id);
    const mine = await otherReviewer.get<{ data: CostRequest[] }>('/cost-requests');
    expect(mine.data.map((r) => r.id)).not.toContain(request.id);
    const proof = await admin.download(`/cost-requests/${request.id}/proof`);
    expect(proof.body.equals(PDF)).toBe(true);
  });

  it('lets the Admin grant less than asked, booked as ADDITIONAL on the budget', async () => {
    const [request] = (await admin.get<{ data: CostRequest[] }>(`/projects/${project.id}/cost-requests`)).data;
    await reviewer.post(`/cost-requests/${request.id}/approve`, {}, 403);
    await admin.post(`/cost-requests/${request.id}/approve`, { grantedVnd: 31_000_000 }, 400);

    const approved = await admin.post<CostRequest>(`/cost-requests/${request.id}/approve`, {
      grantedVnd: 20_000_000,
      response: 'Cấp 20 triệu, thương lượng thêm với studio.',
    });
    expect(approved).toMatchObject({ status: 'APPROVED', grantedVnd: 20_000_000 });
    await admin.post(`/cost-requests/${request.id}/reject`, { response: 'Muộn rồi.' }, 409);

    const after = await ledger();
    expect(after).toMatchObject({ budgetVnd: 110_000_000, remainingVnd: 70_000_000 });
    expect(after.entries.at(-1)).toMatchObject({
      entryType: 'ADDITIONAL',
      amountVnd: 20_000_000,
      request: { id: request.id },
    });
    const bell = await reviewer.get<{ data: { type: string }[] }>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('COST_REQUEST_APPROVED');
  });

  it('refuses with a reason and frees the project for a new request', async () => {
    const path = `/projects/${project.id}/cost-requests`;
    const request = await reviewer.upload<CostRequest>(path, QUOTE, {
      requestedVnd: '5000000',
      reason: 'Thêm nhạc nền.',
    });
    await admin.post(`/cost-requests/${request.id}/reject`, {}, 400);
    const rejected = await admin.post<CostRequest>(`/cost-requests/${request.id}/reject`, { response: 'Không cần.' });
    expect(rejected.status).toBe('REJECTED');
    expect((await ledger()).budgetVnd).toBe(110_000_000);
    await reviewer.upload(path, QUOTE, { requestedVnd: '1000', reason: 'Lần nữa.' });
  });

  it('records the cost events on the project timeline', async () => {
    const events = await reviewer.get<{ action: string }[]>(`/projects/${project.id}/events`);
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'COST_BUDGET_SET',
        'COST_CORRECTED',
        'COST_REQUESTED',
        'COST_REQUEST_APPROVED',
        'COST_ADDED',
        'COST_REQUEST_REJECTED',
      ]),
    );
  });
});
