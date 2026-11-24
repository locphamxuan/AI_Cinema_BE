import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from 'src/common/http/api-exception.filter';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { type Actor, bootApp, signIn } from './support/api';
import { compliantEpisode, priceEpisode, release } from './support/media';
import { registerMember } from './support/members';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

const PRICE = 30;
const PLAN_PRICE = 300;

interface Refund {
  transactionId: string;
  paymentId: string;
  mainCoins: number;
  bonusCoins: number;
  episodeAccessId: string | null;
  subscriptionCycleId: string | null;
  subscriptionEnded: boolean;
}

/**
 * One Coin payment is refunded as a whole and once (24/11/2026): a purchase that took main Coins and
 * several bonus lots is paid back from any of its rows, main as main and bonus as bonus (BR-01, BR-52),
 * a second or simultaneous refund is a 409, and what the payment bought is taken back with it.
 */
describe('Refunding a Coin payment (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: Actor;
  let project: ProjectDetail;
  let planId: string;
  const stamp = Date.now().toString(36);
  const episodeId = () => episodesOf(project)[0].id;

  beforeAll(async () => {
    app = await bootApp();
    prisma = app.get(PrismaService);
    let reviewer: Actor;
    let creator: Actor;
    [reviewer, creator, admin] = await Promise.all([
      signIn(app, 'reviewer01@aicinema.com'),
      signIn(app, 'creator01@aicinema.com'),
      signIn(app, 'admin@aicinema.com'),
    ]);
    project = await projectInProduction(reviewer, creator, 1);
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Người thợ đồng hồ trả lại từng phút đã mượn của thành phố.',
      ageRating: 'T16',
    });
    await compliantEpisode(reviewer, creator, episodeId());
    await priceEpisode(reviewer, episodeId(), PRICE);
    await release(reviewer, `/episodes/${episodeId()}/publications`, {});
    const plan = await admin.post(
      '/admin/membership-plans',
      { code: `e2e_refund_monthly_${stamp}`, name: 'Gói Tháng hoàn Coin e2e', period: 'MONTHLY', durationDays: 30 },
      201,
    );
    await admin.post(`/admin/membership-plans/${plan.id}/prices`, { priceCoins: PLAN_PRICE }, 201);
    planId = plan.id;
  }, 180000);

  afterAll(async () => {
    if (planId) await admin.patch(`/admin/membership-plans/${planId}`, { isActive: false });
    await app.close();
  });

  /** A member holding `main` main Coins and one bonus lot per entry of `lots`. */
  async function member(main: number, lots: number[] = []): Promise<Actor> {
    const actor = await registerMember(app);
    if (main) await admin.post('/admin/wallet-adjustments', { userId: actor.id, mainAmount: main, reason: 'e2e' });
    for (const bonusAmount of lots) {
      await admin.post('/admin/wallet-adjustments', { userId: actor.id, bonusAmount, reason: 'e2e bonus' });
    }
    return actor;
  }

  const wallet = (actor: Actor) => actor.get<{ mainBalance: number; bonusBalance: number }>('/wallet');
  const access = (actor: Actor) => actor.get<{ accessGranted: boolean }>(`/episodes/${episodeId()}/access`);
  const refund = <T = Refund>(transactionId: string, status = 201) =>
    admin.post<T>(`/admin/coin-transactions/${transactionId}/refund`, {}, status);

  /** Buys the episode and answers the rows of that one payment, its first row first. */
  async function buy(actor: Actor) {
    await actor.post(`/episodes/${episodeId()}/purchase`, {}, 201);
    const unlock = await prisma.episodeAccess.findFirstOrThrow({
      where: { userId: actor.id, episodeId: episodeId(), revokedAt: null },
    });
    const rows = await prisma.coinTransaction.findMany({
      where: { paymentId: unlock.coinTransactionId! },
      orderBy: { lotId: { sort: 'asc', nulls: 'first' } },
    });
    return { unlock, rows };
  }

  it('groups a purchase over two bonus lots and refunds it whole from a lot row, once', async () => {
    const buyer = await member(10, [8, 20]);
    const { unlock, rows } = await buy(buyer);
    expect(rows.map((r) => [r.mainAmount, r.bonusAmount])).toEqual(
      expect.arrayContaining([
        [-10, 0],
        [0, -8],
        [0, -12],
      ]),
    );
    expect(rows[0].id).toBe(unlock.coinTransactionId);

    const paid = await refund(rows[2].id);
    expect(paid).toMatchObject({ paymentId: unlock.coinTransactionId, mainCoins: 10, bonusCoins: 20 });
    expect(paid.episodeAccessId).toBe(unlock.id);
    expect(await wallet(buyer)).toMatchObject({ mainBalance: 10, bonusBalance: 28 });
    expect(await access(buyer)).toMatchObject({ accessGranted: false });

    for (const row of rows) {
      const again = await refund<ApiErrorBody>(row.id, 409);
      expect(again.error.details).toMatchObject({
        reason: 'ALREADY_REFUNDED',
        refundTransactionId: paid.transactionId,
      });
    }
    expect(await wallet(buyer)).toMatchObject({ mainBalance: 10, bonusBalance: 28 });
    // The unlock is gone, so the member may buy the episode again.
    await buyer.post(`/episodes/${episodeId()}/purchase`, {}, 201);
  });

  it('pays two simultaneous refunds of one payment once', async () => {
    const buyer = await member(PRICE);
    const { rows } = await buy(buyer);

    const statuses = await Promise.all([
      admin.attempt(`/admin/coin-transactions/${rows[0].id}/refund`),
      admin.attempt(`/admin/coin-transactions/${rows[0].id}/refund`),
    ]);
    expect(statuses.sort()).toEqual([201, 409]);
    expect(await wallet(buyer)).toMatchObject({ mainBalance: PRICE, bonusBalance: 0 });
    expect(await prisma.coinTransaction.count({ where: { reversesId: rows[0].id } })).toBe(1);
  });

  it('refunds a plan payment, marks the cycle REFUNDED and ends the running plan', async () => {
    const buyer = await member(200, [150]);
    const intent = await buyer.post('/subscriptions', { planId }, 201);
    await buyer.post(`/subscriptions/${intent.id}/activate`, {}, 201);
    expect(await access(buyer)).toMatchObject({ accessGranted: true });
    const cycle = await prisma.subscriptionCycle.findFirstOrThrow({ where: { subscriptionId: intent.id } });

    const paid = await refund(cycle.coinTransactionId!);
    expect(paid).toMatchObject({
      mainCoins: 200,
      bonusCoins: 100,
      subscriptionCycleId: cycle.id,
      subscriptionEnded: true,
    });
    expect(await wallet(buyer)).toMatchObject({ mainBalance: 200, bonusBalance: 150 });
    expect(await prisma.subscriptionCycle.findUniqueOrThrow({ where: { id: cycle.id } })).toMatchObject({
      status: 'REFUNDED',
    });
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject({
      status: 'CANCELLED',
      endReason: 'CANCELLED_BY_ADMIN',
    });
    expect(await access(buyer)).toMatchObject({ accessGranted: false });
    await refund(cycle.coinTransactionId!, 409);
  });

  it('refuses a row that is not a payment', async () => {
    const buyer = await member(5);
    const topUp = await prisma.coinTransaction.findFirstOrThrow({ where: { wallet: { userId: buyer.id } } });
    const refused = await refund<ApiErrorBody>(topUp.id, 409);
    expect(refused.error.details).toMatchObject({ reason: 'NOT_REFUNDABLE' });
  });
});
