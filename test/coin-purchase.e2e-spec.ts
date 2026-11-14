import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { ApiErrorBody } from 'src/common/http/api-exception.filter';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { Actor, bootApp, type Row, signIn } from './support/api';
import { compliantEpisode, priceEpisode, release } from './support/media';
import { episodesOf, projectInProduction, type ProjectDetail } from './support/projects';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PRICE = 30;
const PLAN_PRICE = 300;

interface Wallet {
  mainBalance: number;
  bonusBalance: number;
}
interface Purchase extends Wallet {
  episodeId: string;
  paidCoins: number;
  charged: { mainCoins: number; bonusCoins: number };
  access: { source: string };
  accessGranted: boolean;
  idempotent?: boolean;
}
interface Access {
  accessGranted: boolean;
  source: string;
}
interface AutoRenew {
  id: string;
  status: string;
  autoRenew: boolean;
  accessUntil: string;
  currentPeriodEnd: string;
  nextRenewalAt: string | null;
  cancelDeadline: string | null;
}

/** A new member, with the raw token kept so a request can carry an Idempotency-Key. */
interface Member {
  actor: Actor;
  token: string;
}

/**
 * Paying with Coins: BR-01 (main Coins first, bonus lots cover the rest, an Idempotency-Key never
 * charges twice nor crosses flows) and BR-05 (a monthly plan bought with Coins, whose auto-renew can
 * only be stopped until 24 h before the renewal).
 */
describe('Coin purchases and the monthly plan (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: Actor;
  let project: ProjectDetail;
  let planId: string;
  let registered = 0;
  const stamp = Date.now().toString(36);
  const episodeId = (i: number) => episodesOf(project)[i].id;

  async function newMember(): Promise<Member> {
    registered += 1;
    const email = `coin-${stamp}-${registered}@aicinema.test`;
    const password = 'Member@123';
    const server = app.getHttpServer();
    await request(server)
      .post('/api/auth/register')
      .send({ email, password, fullName: 'Thành viên Coin e2e', dateOfBirth: '2000-01-01' })
      .expect(201);
    const login = await request(server).post('/api/auth/login').send({ email, password }).expect(200);
    const body = login.body as { accessToken: string; user: { id: string } };
    return { actor: new Actor(app, body.accessToken, body.user.id), token: body.accessToken };
  }

  /** Coins put in by the Admin: main Coins, and bonus Coins as a lot that expires later. */
  async function fund(member: Member, mainAmount: number, bonusAmount: number) {
    if (mainAmount) {
      await admin.post(
        '/admin/wallet-adjustments',
        { userId: member.actor.id, mainAmount, reason: 'e2e funding' },
        201,
      );
    }
    if (bonusAmount) {
      await admin.post('/admin/wallet-adjustments', { userId: member.actor.id, bonusAmount, reason: 'e2e bonus' }, 201);
    }
  }

  /** A POST that may carry an Idempotency-Key, answering with its status and body. */
  async function postWithKey<T>(member: Member, path: string, key?: string, body: object = {}) {
    let req = request(app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${member.token}`);
    if (key) req = req.set('Idempotency-Key', key);
    const res = await req.send(body);
    return { status: res.status, body: res.body as T };
  }

  const buy = (member: Member, i: number, key?: string) =>
    postWithKey<Purchase & ApiErrorBody>(member, `/episodes/${episodeId(i)}/purchase`, key);
  const wallet = (member: Member) => member.actor.get<Wallet>('/wallet');
  const access = (member: Member, i: number) => member.actor.get<Access>(`/episodes/${episodeId(i)}/access`);
  const ledgerRows = (member: Member) =>
    prisma.coinTransaction.count({ where: { wallet: { userId: member.actor.id } } });

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
    project = await projectInProduction(reviewer, creator, 3);
    await reviewer.patch(`/projects/${project.id}`, {
      synopsis: 'Một thành phố nổi trên mây và cô thợ sửa máy bay giấy.',
      ageRating: 'T16',
    });
    // Two paid episodes and a third the Admin frees for Members (BR-03).
    for (let i = 0; i < 3; i += 1) {
      await compliantEpisode(reviewer, creator, episodeId(i));
      await priceEpisode(reviewer, episodeId(i), PRICE, i === 2 ? { isFreeForMember: true } : undefined);
      await release(reviewer, `/episodes/${episodeId(i)}/publications`, {});
    }
    const plan = await admin.post(
      '/admin/membership-plans',
      { code: `e2e_coin_monthly_${stamp}`, name: 'Gói Tháng Coin e2e', period: 'MONTHLY', durationDays: 30 },
      201,
    );
    await admin.post(`/admin/membership-plans/${plan.id}/prices`, { priceCoins: PLAN_PRICE }, 201);
    planId = plan.id;
  }, 180000);

  afterAll(async () => {
    if (planId) await admin.patch(`/admin/membership-plans/${planId}`, { isActive: false });
    await app.close();
  });

  describe('BR-01: unlocking an episode with Coins', () => {
    it('takes main Coins first and lets bonus Coins cover only the shortfall', async () => {
      const member = await newMember();
      await fund(member, 20, 15);
      expect(await access(member, 0)).toMatchObject({ accessGranted: false });

      const { status, body } = await buy(member, 0);
      expect(status).toBe(201);
      expect(body).toMatchObject({
        episodeId: episodeId(0),
        paidCoins: PRICE,
        charged: { mainCoins: 20, bonusCoins: 10 },
        mainBalance: 0,
        bonusBalance: 5,
        access: { source: 'EPISODE_PURCHASE' },
        accessGranted: true,
      });
      expect(await wallet(member)).toMatchObject({ mainBalance: 0, bonusBalance: 5 });
      expect(await access(member, 0)).toMatchObject({ accessGranted: true, source: 'EPISODE_PURCHASE' });
      // The other paid episode is still locked: one purchase opens one episode.
      expect(await access(member, 1)).toMatchObject({ accessGranted: false });
    });

    it('leaves bonus Coins untouched while main Coins cover the price', async () => {
      const member = await newMember();
      await fund(member, 50, 10);

      const { body } = await buy(member, 0);
      expect(body).toMatchObject({ charged: { mainCoins: PRICE, bonusCoins: 0 }, mainBalance: 20, bonusBalance: 10 });
    });

    it('pays from bonus Coins alone when the member has no main Coins', async () => {
      const member = await newMember();
      await fund(member, 0, 40);

      const { body } = await buy(member, 0);
      expect(body).toMatchObject({ charged: { mainCoins: 0, bonusCoins: PRICE }, mainBalance: 0, bonusBalance: 10 });
    });

    it('accepts a wallet holding exactly the price and empties it', async () => {
      const member = await newMember();
      await fund(member, 10, 20);

      const { status, body } = await buy(member, 0);
      expect(status).toBe(201);
      expect(body).toMatchObject({ charged: { mainCoins: 10, bonusCoins: 20 }, mainBalance: 0, bonusBalance: 0 });
    });

    it('refuses one Coin short with 422 INSUFFICIENT_COINS and moves nothing', async () => {
      const member = await newMember();
      await fund(member, 10, 19);
      const rowsBefore = await ledgerRows(member);

      const { status, body } = await buy(member, 0);
      expect(status).toBe(422);
      expect(body.error.details).toMatchObject({
        reason: 'INSUFFICIENT_COINS',
        requiredCoins: PRICE,
        mainBalance: 10,
        bonusBalance: 19,
        missingCoins: 1,
      });
      expect(await wallet(member)).toMatchObject({ mainBalance: 10, bonusBalance: 19 });
      expect(await ledgerRows(member)).toBe(rowsBefore);
      expect(await access(member, 0)).toMatchObject({ accessGranted: false });
    });

    it('refuses an empty wallet with INSUFFICIENT_COINS', async () => {
      const member = await newMember();
      const { status, body } = await buy(member, 0);
      expect(status).toBe(422);
      expect(body.error.details).toMatchObject({ reason: 'INSUFFICIENT_COINS', missingCoins: PRICE });
    });

    it('replays the same Idempotency-Key without charging twice', async () => {
      const member = await newMember();
      await fund(member, 100, 0);
      const key = randomUUID();

      const first = await buy(member, 0, key);
      const again = await buy(member, 0, key);
      expect(first.status).toBe(201);
      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({
        episodeId: episodeId(0),
        paidCoins: PRICE,
        charged: first.body.charged,
        mainBalance: first.body.mainBalance,
        idempotent: true,
      });
      expect(first.body.idempotent).toBeUndefined();
      expect(await wallet(member)).toMatchObject({ mainBalance: 100 - PRICE });
      expect(await prisma.episodeAccess.count({ where: { userId: member.actor.id } })).toBe(1);
    });

    it('answers a second purchase without a key with 409 ACCESS_ALREADY_OWNED and no charge', async () => {
      const member = await newMember();
      await fund(member, 100, 0);
      await buy(member, 0);

      const { status, body } = await buy(member, 0);
      expect(status).toBe(409);
      expect(body.error.details).toMatchObject({ reason: 'ACCESS_ALREADY_OWNED' });
      expect(await wallet(member)).toMatchObject({ mainBalance: 100 - PRICE });
    });

    it('charges once when two taps arrive together without a key', async () => {
      const member = await newMember();
      await fund(member, 100, 0);

      const results = await Promise.all([buy(member, 1), buy(member, 1)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await wallet(member)).toMatchObject({ mainBalance: 100 - PRICE });
    });

    it('does not let a key already used for one episode unlock another', async () => {
      const member = await newMember();
      await fund(member, 100, 0);
      const key = randomUUID();
      await buy(member, 0, key);

      const other = await buy(member, 1, key);
      expect(other.status).toBe(409);
      expect(other.body.error.details).toMatchObject({ reason: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await access(member, 1)).toMatchObject({ accessGranted: false });
      expect(await wallet(member)).toMatchObject({ mainBalance: 100 - PRICE });
    });

    it('refuses an episode free for Members, an unknown one and a malformed id', async () => {
      const member = await newMember();
      await fund(member, 100, 0);

      const free = await buy(member, 2);
      expect(free.status).toBe(409);
      expect(free.body.error.details).toMatchObject({ reason: 'ACCESS_ALREADY_OWNED' });
      const unknown = await postWithKey<ApiErrorBody>(member, `/episodes/${randomUUID()}/purchase`);
      expect(unknown.status).toBe(409);
      expect(unknown.body.error.details).toMatchObject({ reason: 'EPISODE_NOT_PUBLISHED' });
      expect((await postWithKey(member, '/episodes/not-a-uuid/purchase')).status).toBe(400);
      expect(await wallet(member)).toMatchObject({ mainBalance: 100 });
    });

    it('requires a signed-in member', async () => {
      await request(app.getHttpServer())
        .post(`/api/episodes/${episodeId(0)}/purchase`)
        .expect(401);
    });
  });

  describe('An Idempotency-Key belongs to one flow', () => {
    it('refuses a purchase that reuses the daily check-in key with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const member = await newMember();
      await fund(member, 100, 0);
      const key = randomUUID();

      const checkIn = await postWithKey<{ bonusGranted: number }>(member, '/daily-rewards/check-in', key);
      expect(checkIn.status).toBe(201);
      const before = await wallet(member);
      expect(before).toMatchObject({ mainBalance: 100, bonusBalance: checkIn.body.bonusGranted });
      const rowsBefore = await ledgerRows(member);

      const { status, body } = await buy(member, 0, key);
      expect(status).toBe(409);
      expect(body.error.details).toMatchObject({ reason: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await wallet(member)).toEqual(expect.objectContaining(before));
      expect(await ledgerRows(member)).toBe(rowsBefore);
      expect(await access(member, 0)).toMatchObject({ accessGranted: false });
      expect(await prisma.episodeAccess.count({ where: { userId: member.actor.id } })).toBe(0);
    });

    it('refuses a key another member already spent, and leaves the second wallet alone', async () => {
      const [first, second] = [await newMember(), await newMember()];
      await fund(first, 100, 0);
      await fund(second, 100, 0);
      const key = randomUUID();
      expect((await buy(first, 0, key)).status).toBe(201);

      const { status, body } = await buy(second, 0, key);
      expect(status).toBe(409);
      expect(body.error.details).toMatchObject({ reason: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await wallet(second)).toMatchObject({ mainBalance: 100 });
      expect(await access(second, 0)).toMatchObject({ accessGranted: false });
    });
  });

  describe('BR-05: the monthly plan paid with Coins', () => {
    /** Quotes and pays the plan; returns the running subscription. */
    async function runningPlan(member: Member, key = randomUUID()) {
      const intent = await member.actor.post('/subscriptions', { planId }, 201);
      const paid = await postWithKey<Row>(member, `/subscriptions/${intent.id}/activate`, key);
      expect(paid.status).toBe(201);
      return { id: intent.id, key, paid: paid.body };
    }

    it('quotes without moving Coins, then charges main before bonus and opens every episode', async () => {
      const member = await newMember();
      await fund(member, 200, 150);

      const intent = await member.actor.post('/subscriptions', { planId }, 201);
      expect(intent).toMatchObject({ status: 'PENDING', autoRenew: true, priceCoins: PLAN_PRICE, enoughCoins: true });
      const periodEnd = new Date(intent.currentPeriodEnd as string).getTime();
      expect(periodEnd - new Date(intent.cancelDeadline as string).getTime()).toBe(DAY_MS);
      expect(await wallet(member)).toMatchObject({ mainBalance: 200, bonusBalance: 150 });

      const key = randomUUID();
      const paid = await postWithKey<Row>(member, `/subscriptions/${intent.id}/activate`, key);
      expect(paid.status).toBe(201);
      expect(paid.body).toMatchObject({ status: 'ACTIVE', charged: { mainCoins: 200, bonusCoins: 100 } });
      expect(await wallet(member)).toMatchObject({ mainBalance: 0, bonusBalance: 50 });

      // Paying the same intent again is refused, and charges nothing.
      const again = await postWithKey<ApiErrorBody>(member, `/subscriptions/${intent.id}/activate`, key);
      expect(again.status).toBe(409);
      expect(again.body.error.details).toMatchObject({ reason: 'SUBSCRIPTION_NOT_PENDING' });
      expect(await wallet(member)).toMatchObject({ mainBalance: 0, bonusBalance: 50 });

      expect(await access(member, 1)).toMatchObject({ accessGranted: true, source: 'PLAN' });
      // A running plan already opens the episode: buying it is refused and costs nothing.
      await fund(member, 50, 0);
      const bought = await buy(member, 1);
      expect(bought.status).toBe(409);
      expect(bought.body.error.details).toMatchObject({ reason: 'ACCESS_ALREADY_OWNED' });
      expect(await wallet(member)).toMatchObject({ mainBalance: 50 });
    });

    it('keeps the intent PENDING when the Coins fall short (422 INSUFFICIENT_COINS)', async () => {
      const member = await newMember();
      await fund(member, PLAN_PRICE - 1, 0);

      const intent = await member.actor.post('/subscriptions', { planId }, 201);
      expect(intent).toMatchObject({ enoughCoins: false, missingCoins: 1 });
      const paid = await postWithKey<ApiErrorBody>(member, `/subscriptions/${intent.id}/activate`);
      expect(paid.status).toBe(422);
      expect(paid.body.error.details).toMatchObject({ reason: 'INSUFFICIENT_COINS' });
      expect(await member.actor.get('/subscriptions/me')).toMatchObject({ status: 'PENDING' });
      expect(await wallet(member)).toMatchObject({ mainBalance: PLAN_PRICE - 1 });

      await fund(member, 1, 0);
      expect((await postWithKey(member, `/subscriptions/${intent.id}/activate`)).status).toBe(201);
    });

    it('stops auto-renew before the window, keeps access to the period end, and resumes it', async () => {
      const member = await newMember();
      await fund(member, PLAN_PRICE, 0);
      const { id } = await runningPlan(member);

      const cancelled = await member.actor.post<AutoRenew>(`/subscriptions/${id}/cancel-auto-renew`, {}, 201);
      expect(cancelled).toMatchObject({
        status: 'ACTIVE',
        autoRenew: false,
        nextRenewalAt: null,
        cancelDeadline: null,
      });
      expect(new Date(cancelled.accessUntil).getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS);
      expect(await access(member, 0)).toMatchObject({ accessGranted: true, source: 'PLAN' });

      // Stopping twice answers the same state.
      const twice = await member.actor.post<AutoRenew>(`/subscriptions/${id}/cancel-auto-renew`, {}, 201);
      expect(twice).toMatchObject({ autoRenew: false, accessUntil: cancelled.accessUntil });

      const resumed = await member.actor.post<AutoRenew>(`/subscriptions/${id}/resume-auto-renew`, {}, 201);
      expect(resumed).toMatchObject({ autoRenew: true, nextRenewalAt: cancelled.currentPeriodEnd });
      expect(new Date(resumed.currentPeriodEnd).getTime() - new Date(resumed.cancelDeadline!).getTime()).toBe(DAY_MS);
    });

    it('refuses to stop the renewal inside the last 24 h (422 CANCELLATION_WINDOW_CLOSED)', async () => {
      const member = await newMember();
      await fund(member, PLAN_PRICE, 0);
      const { id } = await runningPlan(member);
      // The renewal is moved to 23 h from now rather than travelling in time.
      const renewalAt = new Date(Date.now() + 23 * HOUR_MS);
      await prisma.subscription.update({
        where: { id },
        data: {
          currentPeriodEnd: renewalAt,
          nextRenewalAt: renewalAt,
          cancelWindowEndsAt: new Date(renewalAt.getTime() - DAY_MS),
        },
      });

      const refused = await postWithKey<ApiErrorBody>(member, `/subscriptions/${id}/cancel-auto-renew`);
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toMatchObject({ reason: 'CANCELLATION_WINDOW_CLOSED' });
      expect(await prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ autoRenew: true });
    });

    it('still accepts the cancellation just before the 24 h mark', async () => {
      const member = await newMember();
      await fund(member, PLAN_PRICE, 0);
      const { id } = await runningPlan(member);
      const renewalAt = new Date(Date.now() + DAY_MS + 5 * 60_000);
      await prisma.subscription.update({
        where: { id },
        data: {
          currentPeriodEnd: renewalAt,
          nextRenewalAt: renewalAt,
          cancelWindowEndsAt: new Date(renewalAt.getTime() - DAY_MS),
        },
      });

      const cancelled = await member.actor.post<AutoRenew>(`/subscriptions/${id}/cancel-auto-renew`, {}, 201);
      expect(cancelled).toMatchObject({ autoRenew: false });
    });

    it("answers someone else's subscription with 404 and an unpaid intent with 409", async () => {
      const [owner, stranger] = [await newMember(), await newMember()];
      await fund(owner, PLAN_PRICE, 0);
      const { id } = await runningPlan(owner);
      const foreign = await postWithKey<ApiErrorBody>(stranger, `/subscriptions/${id}/cancel-auto-renew`);
      expect(foreign.status).toBe(404);

      const intent = await stranger.actor.post('/subscriptions', { planId }, 201);
      const pending = await postWithKey<ApiErrorBody>(stranger, `/subscriptions/${intent.id}/cancel-auto-renew`);
      expect(pending.status).toBe(409);
      expect(pending.body.error.details).toMatchObject({ reason: 'SUBSCRIPTION_NOT_ACTIVE' });
    });
  });
});
