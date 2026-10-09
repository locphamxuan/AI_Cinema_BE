import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { type Actor, bootApp, type Row, signIn } from './support/api';
import { inDays } from './support/projects';

interface Wallet {
  grantedTokens: number;
  allocatedTokens: number;
  balanceTokens: number;
  history: { kind: string; amountTokens: number; movie: { title: string } | null }[];
}

type Bell = { data: { type: string; title: string }[] };

describe('Reviewer Token budget (e2e)', () => {
  let app: INestApplication<App>;
  let admin: Actor;
  let reviewer: Actor;

  const wallet = () => reviewer.get<Wallet>('/reviewer-tokens/me');
  const grant = (body: object, status = 201) =>
    admin.post<Wallet>(`/admin/reviewer-tokens/${reviewer.id}/entries`, body, status);

  beforeAll(async () => {
    app = await bootApp();
    [admin, reviewer] = await Promise.all([signIn(app, 'admin@aicinema.com'), signIn(app, 'reviewer06@aicinema.com')]);
  });

  afterAll(() => app.close());

  it('shows the Admin every Reviewer’s budget, and nobody else', async () => {
    const reviewers = await admin.get<(Row & { balanceTokens: number })[]>('/admin/reviewer-tokens');
    // The seed tops development Reviewers up to 1,000,000 Token.
    expect(reviewers.find((r) => r.id === reviewer.id)?.balanceTokens).toBeGreaterThanOrEqual(1_000_000);
    await reviewer.get('/admin/reviewer-tokens', 403);
    await reviewer.post(`/admin/reviewer-tokens/${reviewer.id}/entries`, { entryType: 'GRANT', amountTokens: 1 }, 403);
  });

  it('lets the Admin take back only what is left, with a reason', async () => {
    const { balanceTokens } = await wallet();
    await grant({ entryType: 'REVOKE', amountTokens: 1000 }, 400);
    await grant({ entryType: 'REVOKE', amountTokens: balanceTokens + 1, reason: 'Quá số dư.' }, 409);
    const after = await grant({
      entryType: 'REVOKE',
      amountTokens: balanceTokens - 50_000,
      reason: 'Thu về cuối quý.',
    });
    expect(after.balanceTokens).toBe(50_000);

    const bell = await reviewer.get<Bell>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('TOKEN_REVOKED');
  });

  it('pays production fees out of the budget and tells the Admin', async () => {
    const genreId = (await reviewer.get<{ data: Row[] }>('/genres?limit=1')).data[0].id;
    const project = await reviewer.post<Row>('/projects', {
      title: `Ngân sách e2e ${Date.now()}`,
      ideaDescription: 'Một bộ phim để kiểm tra ngân sách Token của Reviewer.',
      genreIds: [genreId],
      seasons: [{ episodes: [{ title: 'Tập 1', targetDurationSeconds: 900, milestoneDate: inDays(30) }] }],
    });
    await reviewer.post(`/projects/${project.id}/fee/entries`, { entryType: 'INITIAL', amountTokens: 60_000 }, 409);
    await reviewer.post(`/projects/${project.id}/fee/entries`, { entryType: 'INITIAL', amountTokens: 30_000 });

    const mine = await wallet();
    expect(mine.balanceTokens).toBe(20_000);
    expect(mine.history[0]).toMatchObject({ kind: 'ALLOCATION', amountTokens: -30_000 });

    const bell = await admin.get<Bell>('/notifications?limit=100');
    const allocated = bell.data.find((n) => n.type === 'TOKEN_ALLOCATED' && n.title.includes('Ngân sách e2e'));
    expect(allocated?.title).toContain('30000');

    // A correction that lowers the fee gives the Token back to the Reviewer.
    await reviewer.post(`/projects/${project.id}/fee/entries`, {
      entryType: 'CORRECTION',
      amountTokens: -10_000,
      reason: 'Studio giảm giá.',
    });
    expect((await wallet()).balanceTokens).toBe(30_000);
  });

  it('adds what the Admin grants and tells the Reviewer', async () => {
    const after = await grant({ entryType: 'GRANT', amountTokens: 100_000, reason: 'Ngân sách quý 4.' });
    expect(after.balanceTokens).toBe(130_000);
    const bell = await reviewer.get<Bell>('/notifications?limit=100');
    expect(bell.data.map((n) => n.type)).toContain('TOKEN_GRANTED');
  });
});
