import { INestApplication } from '@nestjs/common';
import { CoinEntryType } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { Actor, bootApp, signIn } from './support/api';
import { fundWallet } from './support/members';

interface FlagPage {
  data: {
    id: string;
    ruleCode: string;
    status: string;
    coinTransaction: { entryType: string; wallet: { user: { id: string; isActive: boolean } } };
  }[];
}

let registered = 0;

/** A new member, with the refresh token the lock must revoke. */
async function newMember(app: INestApplication<App>) {
  registered += 1;
  const email = `risk-${Date.now()}-${registered}@aicinema.test`;
  const password = 'Member@123';
  const server = app.getHttpServer();
  await request(server)
    .post('/api/auth/register')
    .send({ email, password, fullName: 'Thành viên rủi ro e2e', dateOfBirth: '2000-01-01', acceptedTerms: true })
    .expect(201);
  const login = await request(server).post('/api/auth/login').send({ email, password }).expect(200);
  const body = login.body as { accessToken: string; refreshToken: string; user: { id: string } };
  return { actor: new Actor(app, body.accessToken, body.user.id), refreshToken: body.refreshToken, email, password };
}

/** MF-5, Admin only: profit / ROI per movie (BR-48 plan share included) and risky Coin transactions. */
describe('Finance and risk (e2e)', () => {
  let app: INestApplication<App>;
  let admin: Actor;

  beforeAll(async () => {
    app = await bootApp();
    admin = await signIn(app, 'admin@aicinema.com');
  }, 120000);

  afterAll(() => app.close());

  /** A member with one top-up of 6 000 Coins (6 000 000 VND at 1 000 VND), flagged by LARGE_TOP_UP. */
  async function flaggedMember() {
    const member = await newMember(app);
    await fundWallet(app, member.actor.id, 6000, [], CoinEntryType.TOP_UP);
    await app.get(PrismaService).coinTransaction.updateMany({
      where: { wallet: { userId: member.actor.id }, entryType: CoinEntryType.TOP_UP },
      data: { rateVnd: 1000 },
    });
    const scan = await admin.post<{ created: number; rules: { code: string; created: number }[] }>(
      '/admin/finance/risk/scan',
      {},
      200,
    );
    expect(scan.rules).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LARGE_TOP_UP' })]));
    const page = await admin.get<FlagPage>('/admin/finance/risk/flags?filter.status=$eq:OPEN&limit=100');
    const flag = page.data.find((f) => f.coinTransaction.wallet.user.id === member.actor.id);
    expect(flag).toMatchObject({ ruleCode: 'LARGE_TOP_UP', coinTransaction: { entryType: 'TOP_UP' } });
    return { member, flag: flag! };
  }

  it('reads profit and ROI for every movie', async () => {
    const body = await admin.get<{
      currentPeriod: string;
      totals: { productionCostVnd: number; episodeSalesVnd: number; planShareVnd: number };
      films: { roiPercent: number | null; breakEven: string }[];
    }>('/admin/finance/films');
    expect(body.currentPeriod).toMatch(/^\d{4}-\d{2}$/);
    expect(body.totals.productionCostVnd).toEqual(expect.any(Number));
    expect(body.totals.episodeSalesVnd).toEqual(expect.any(Number));
    expect(Array.isArray(body.films)).toBe(true);
    await admin.post('/admin/finance/revenue-allocations/2026-01/run', {}, 404);
  });

  it('flags a large top-up once and lets the Admin dismiss it once', async () => {
    const { flag } = await flaggedMember();
    const again = await admin.post<{ created: number }>('/admin/finance/risk/scan', {}, 200);
    expect(again.created).toBe(0);

    await admin.post(`/admin/finance/risk/flags/${flag.id}/review`, { decision: 'DISMISSED', note: 'Hợp lệ' }, 200);
    await admin.post(`/admin/finance/risk/flags/${flag.id}/review`, { decision: 'ACCOUNT_LOCKED', note: 'x' }, 409);
  });

  it('locks the member from a flag: signed out at once, unlocked later from the accounts screen', async () => {
    const { member, flag } = await flaggedMember();
    await admin.post(`/admin/finance/risk/flags/${flag.id}/review`, { decision: 'ACCOUNT_LOCKED' }, 400);

    const locked = await admin.post<{ status: string; reviewNote: string; reviewedAt: string }>(
      `/admin/finance/risk/flags/${flag.id}/review`,
      { decision: 'ACCOUNT_LOCKED', note: 'Nạp lớn bất thường' },
      200,
    );
    expect(locked).toMatchObject({ status: 'ACCOUNT_LOCKED', reviewNote: 'Nạp lớn bất thường' });
    const server = app.getHttpServer();
    await member.actor.get('/wallet', 401);
    await request(server).post('/api/auth/refresh').send({ refreshToken: member.refreshToken }).expect(401);
    await request(server).post('/api/auth/login').send({ email: member.email, password: member.password }).expect(403);

    const events = await app.get(PrismaService).auditLog.findMany({ where: { entityId: flag.id } });
    expect(events.map((e) => e.action)).toContain('TRANSACTION_FLAG_REVIEWED');

    await admin.patch(`/users/${member.actor.id}`, { isActive: true }, 200);
    await request(server).post('/api/auth/login').send({ email: member.email, password: member.password }).expect(200);
  });

  it('keeps every finance route away from a Member', async () => {
    const { actor } = await newMember(app);
    await actor.get('/admin/finance/films', 403);
    await actor.get('/admin/finance/risk/flags', 403);
  });
});
