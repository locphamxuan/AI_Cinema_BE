import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { previousPeriod } from 'src/modules/platform/finance/finance-period';
import { Actor, bootApp, signIn } from './support/api';
import { registerMember } from './support/members';

interface FlagPage {
  data: { id: string; ruleCode: string; status: string; coinTransaction: { entryType: string } }[];
}

/** MF-5, Admin only: profit / ROI per movie, BR-48 revenue sharing by watch time and risky Coin transactions. */
describe('Finance and risk (e2e)', () => {
  let app: INestApplication<App>;
  let admin: Actor;
  let member: Actor;

  beforeAll(async () => {
    app = await bootApp();
    admin = await signIn(app, 'admin@aicinema.com');
    member = await registerMember(app);
  }, 120000);

  afterAll(() => app.close());

  it('reads profit and ROI for every movie', async () => {
    const body = await admin.get<{ totals: { productionCostVnd: number }; films: { roiPercent: number | null }[] }>(
      '/admin/finance/films',
    );
    expect(body.totals.productionCostVnd).toEqual(expect.any(Number));
    expect(Array.isArray(body.films)).toBe(true);
  });

  it('shares last month again without doubling, and refuses the current month', async () => {
    const period = previousPeriod(new Date());
    const first = await admin.post<{ period: string }>(`/admin/finance/revenue-allocations/${period}/run`, {}, 200);
    const again = await admin.post<{ movies: unknown[] }>(`/admin/finance/revenue-allocations/${period}/run`, {}, 200);
    const listed = await admin.get<{ movies: unknown[] }>(`/admin/finance/revenue-allocations?period=${period}`);
    expect(first.period).toBe(period);
    expect(listed.movies).toHaveLength(again.movies.length);
    await admin.post('/admin/finance/revenue-allocations/2999-01/run', {}, 409);
  });

  it('flags a large hand correction and lets the Admin dismiss it once', async () => {
    await admin.post(
      '/admin/wallet-adjustments',
      { userId: member.id, mainAmount: 5000, reason: 'e2e large correction' },
      201,
    );
    await admin.post('/admin/finance/risk/scan', {}, 200);
    const page = await admin.get<FlagPage>('/admin/finance/risk/flags?filter.status=$eq:OPEN&limit=100');
    const flag = page.data.find((f) => f.ruleCode === 'LARGE_ADJUSTMENT');
    expect(flag?.coinTransaction.entryType).toBe('ADJUSTMENT');
    const again = await admin.post<{ created: number }>('/admin/finance/risk/scan', {}, 200);
    expect(again.created).toBe(0);

    await admin.post(`/admin/finance/risk/flags/${flag!.id}/review`, { decision: 'DISMISSED', note: 'Hợp lệ' }, 200);
    await admin.post(`/admin/finance/risk/flags/${flag!.id}/review`, { decision: 'CONFIRMED' }, 409);
  });

  it('keeps every finance route away from a Member', async () => {
    await member.get('/admin/finance/films', 403);
    await member.get('/admin/finance/risk/flags', 403);
  });
});
