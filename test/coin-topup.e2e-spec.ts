import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hmacSha256Hex } from 'src/modules/episode-access/coin-topup/gateways/momo-signing';
import { signVnpayParams } from 'src/modules/episode-access/coin-topup/gateways/vnpay-signing';
import { PaymentReconcileSweep } from 'src/modules/episode-access/coin-topup/payment-reconcile.sweep';
import { TopUpExpirySweep } from 'src/modules/episode-access/coin-topup/top-up-expiry.sweep';
import { type Actor, bootApp, type Row } from './support/api';
import { registerMember } from './support/members';

interface Order {
  topUpId: string;
  provider: string;
  providerTxnId: string;
  amountVnd: number;
  coinsGranted: number;
  status: string;
  redirectUrl: string | null;
}
interface Wallet {
  mainBalance: number;
  bonusBalance: number;
}

const VNPAY_SECRET = 'e2e-vnpay-hash-secret';
const MOMO = { partnerCode: 'MOMOE2E', accessKey: 'e2e-access', secretKey: 'e2e-momo-secret' };

/**
 * A stand-in for both gateways' server APIs: MoMo's create-order and status calls, and
 * VNPay's querydr. Each test sets what the next call answers.
 */
class FakeGateway {
  momoCreate: { status: number; body: object } = {
    status: 200,
    body: { resultCode: 0, payUrl: 'https://momo.test/pay' },
  };
  momoStatus: object = { resultCode: 1000 };
  vnpayQuery: object = { vnp_ResponseCode: '91' };
  private server?: Server;

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const reply = (status: number, body: object) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.url === '/momo/create') return reply(this.momoCreate.status, this.momoCreate.body);
        if (req.url === '/momo/status') return reply(200, this.momoStatus);
        if (req.url === '/vnpay/query') return reply(200, this.vnpayQuery);
        reply(404, {});
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

/** The VNPay IPN query of a paid (or refused) order, signed as VNPay signs it. */
function vnpayIpn(txnRef: string, amountVnd: number, responseCode = '00', secret = VNPAY_SECRET) {
  const params: Record<string, string> = {
    vnp_Amount: String(amountVnd * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: `Nap-Coin-${txnRef}`,
    vnp_PayDate: '20261009120000',
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: 'E2ETMN01',
    vnp_TransactionNo: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    vnp_TransactionStatus: responseCode,
    vnp_TxnRef: txnRef,
  };
  return { ...params, vnp_SecureHash: signVnpayParams(params, secret) };
}

/** A MoMo IPN body for an order, signed with the partner secret. */
function momoIpn(order: Order, resultCode = 0, amount = order.amountVnd) {
  const body = {
    partnerCode: MOMO.partnerCode,
    orderId: order.providerTxnId,
    requestId: order.providerTxnId,
    amount,
    orderInfo: 'Nap Coin',
    orderType: 'momo_wallet',
    transId: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    resultCode,
    message: resultCode === 0 ? 'Successful.' : 'Transaction denied by user.',
    payType: 'qr',
    responseTime: Date.now(),
    extraData: Buffer.from(JSON.stringify({ topUpId: order.topUpId })).toString('base64'),
  };
  const raw = [
    `accessKey=${MOMO.accessKey}`,
    `amount=${body.amount}`,
    `extraData=${body.extraData}`,
    `message=${body.message}`,
    `orderId=${body.orderId}`,
    `orderInfo=${body.orderInfo}`,
    `orderType=${body.orderType}`,
    `partnerCode=${body.partnerCode}`,
    `payType=${body.payType}`,
    `requestId=${body.requestId}`,
    `responseTime=${body.responseTime}`,
    `resultCode=${body.resultCode}`,
    `transId=${body.transId}`,
  ].join('&');
  return { ...body, signature: hmacSha256Hex(MOMO.secretKey, raw) };
}

describe('Coin top-up through VNPay and MoMo (e2e)', () => {
  let app: INestApplication<App>;
  let member: Actor;
  let other: Actor;
  const gateway = new FakeGateway();
  const http = () => request(app.getHttpServer());
  const ipn = async (query: Record<string, string>) =>
    (await http().get('/api/payments/vnpay/callback').query(query).expect(200)).body as { RspCode: string };
  const order = (provider: string, amountVnd: number, status?: number) =>
    member.post<Order>('/wallet/top-ups', { provider, amountVnd }, status);
  const wallet = () => member.get<Wallet>('/wallet');

  beforeAll(async () => {
    const base = await gateway.start();
    Object.assign(process.env, {
      VNPAY_TMN_CODE: 'E2ETMN01',
      VNPAY_HASH_SECRET: VNPAY_SECRET,
      VNPAY_PAY_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      VNPAY_RETURN_URL: 'http://localhost:3001/api/payments/vnpay/return',
      VNPAY_IPN_URL: 'http://localhost:3001/api/payments/vnpay/callback',
      VNPAY_API_URL: `${base}/vnpay/query`,
      MOMO_PARTNER_CODE: MOMO.partnerCode,
      MOMO_ACCESS_KEY: MOMO.accessKey,
      MOMO_SECRET_KEY: MOMO.secretKey,
      MOMO_CREATE_URL: `${base}/momo/create`,
      MOMO_STATUS_URL: `${base}/momo/status`,
      MOMO_REDIRECT_URL: 'http://localhost:3001/api/payments/momo/return',
      MOMO_IPN_URL: 'http://localhost:3001/api/payments/momo/callback',
    });
    app = await bootApp();
    member = await registerMember(app);
    other = await registerMember(app);
  });

  afterAll(async () => {
    await app.close();
    await gateway.stop();
  });

  it('tells the member the rate and the accepted range before an order', async () => {
    expect(await member.get('/wallet/top-ups/options')).toEqual({ rateVnd: 1000, minVnd: 10_000, maxVnd: 2_000_000 });
  });

  it('quotes an order within the range and signs the VNPay payment link', async () => {
    await order('VNPAY', 5000, 422);
    await order('VNPAY', 5_000_000, 422);
    await order('PAYPAL', 50_000, 400);

    const created = await order('VNPAY', 50_000);
    expect(created).toMatchObject({ provider: 'VNPAY', amountVnd: 50_000, coinsGranted: 50, status: 'PENDING' });
    const link = new URL(created.redirectUrl!);
    expect(link.searchParams.get('vnp_TxnRef')).toBe(created.providerTxnId);
    expect(link.searchParams.get('vnp_Amount')).toBe('5000000');
    expect(link.searchParams.get('vnp_SecureHash')).toMatch(/^[0-9a-f]{128}$/);
  });

  it('credits the wallet once on a signed VNPay IPN, and answers each failure in VNPay codes', async () => {
    const created = await order('VNPAY', 30_000);
    const before = await wallet();

    expect(await ipn({ ...vnpayIpn(created.providerTxnId, 30_000), vnp_SecureHash: 'f'.repeat(128) })).toMatchObject({
      RspCode: '97',
    });
    expect(await ipn(vnpayIpn(created.providerTxnId, 30_000, '00', 'wrong-secret'))).toMatchObject({ RspCode: '97' });
    expect(await ipn(vnpayIpn('VNPAY-UNKNOWN', 30_000))).toMatchObject({ RspCode: '01' });

    const paid = vnpayIpn(created.providerTxnId, 30_000);
    expect(await ipn(paid)).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await ipn(paid)).toMatchObject({ RspCode: '02' });
    expect(await ipn(vnpayIpn(created.providerTxnId, 30_000))).toMatchObject({ RspCode: '02' });

    expect((await wallet()).mainBalance).toBe(before.mainBalance + 30);
    expect(await member.get<Order>(`/wallet/top-ups/${created.topUpId}`)).toMatchObject({ status: 'PAID' });

    // The member's browser comes back through the return URL: it only forwards, never settles.
    const back = await http().get('/api/payments/vnpay/return').query({ vnp_TxnRef: created.providerTxnId });
    expect(back.status).toBe(302);
    expect(back.headers.location).toContain(`/wallet/top-ups/${created.topUpId}?status=PAID&provider=VNPAY`);
    const lost = await http().get('/api/payments/vnpay/return').query({ vnp_TxnRef: 'VNPAY-UNKNOWN' });
    expect(lost.headers.location).toContain('status=FAILED');
    expect((await http().get('/api/payments/vnpay/return')).headers.location).toContain('status=FAILED');
  });

  it('fails the order on a wrong amount or a refused payment, and never credits it', async () => {
    const before = await wallet();

    const short = await order('VNPAY', 20_000);
    expect(await ipn(vnpayIpn(short.providerTxnId, 10_000))).toMatchObject({ RspCode: '04' });
    expect(await member.get<Order>(`/wallet/top-ups/${short.topUpId}`)).toMatchObject({ status: 'FAILED' });

    const refused = await order('VNPAY', 20_000);
    expect(await ipn(vnpayIpn(refused.providerTxnId, 20_000, '24'))).toEqual({
      RspCode: '00',
      Message: 'Received and recorded',
    });
    expect(await member.get<Order>(`/wallet/top-ups/${refused.topUpId}`)).toMatchObject({ status: 'FAILED' });

    expect(await wallet()).toMatchObject({ mainBalance: before.mainBalance });
  });

  it('accepts the JSON webhook shape only when it is signed', async () => {
    const created = await order('VNPAY', 10_000);
    await http()
      .post('/api/payments/vnpay/callback')
      .send({ eventId: 'e1', amountVnd: 10_000, status: 'success' })
      .expect(400);
    await http()
      .post('/api/payments/vnpay/callback')
      .send({ eventId: 'e2', amountVnd: 10_000, status: 'success', signature: 'forged' })
      .expect(400);
    await http().post('/api/payments/vnpay/callback').send({ signature: 'forged' }).expect(400);

    const settled = await http().post('/api/payments/vnpay/callback').send(vnpayIpn(created.providerTxnId, 10_000));
    expect(settled.status).toBe(201);
    expect(settled.body).toMatchObject({ topUpId: created.topUpId, status: 'PAID' });
  });

  it('pays through MoMo: the create call, the signed IPN, its replay and the return trip', async () => {
    const before = await wallet();
    const created = await order('MOMO', 20_000);
    expect(created).toMatchObject({ provider: 'MOMO', redirectUrl: 'https://momo.test/pay', status: 'PENDING' });

    const forged = { ...momoIpn(created), signature: 'a'.repeat(64) };
    await http().post('/api/payments/momo/callback').send(forged).expect(400);

    const paid = momoIpn(created);
    const first = await http().post('/api/payments/momo/callback').send(paid).expect(201);
    expect(first.body).toMatchObject({ topUpId: created.topUpId, status: 'PAID' });
    const replay = await http().post('/api/payments/momo/callback').send(paid).expect(201);
    expect(replay.body).toMatchObject({ topUpId: created.topUpId, status: 'PAID' });
    expect((await wallet()).mainBalance).toBe(before.mainBalance + 20);

    const back = await http().get('/api/payments/momo/return').query({ topUpId: created.topUpId });
    expect(back.status).toBe(302);
    expect(back.headers.location).toContain(`/wallet/top-ups/${created.topUpId}?status=PAID&provider=MOMO`);
    await http().get('/api/payments/momo/return').query({ topUpId: 'not-a-uuid' }).expect(400);
    await http().get('/api/payments/paypal/return').expect(404);

    const cancelled = await order('MOMO', 20_000);
    await http().post('/api/payments/momo/callback').send(momoIpn(cancelled, 1006)).expect(201);
    expect(await member.get<Order>(`/wallet/top-ups/${cancelled.topUpId}`)).toMatchObject({ status: 'FAILED' });
  });

  it('fails the order outright when MoMo refuses or cannot be reached', async () => {
    gateway.momoCreate = { status: 200, body: { resultCode: 22, message: 'Amount out of range' } };
    await order('MOMO', 20_000, 502);
    gateway.momoCreate = { status: 503, body: {} };
    await order('MOMO', 20_000, 502);
    gateway.momoCreate = { status: 200, body: { resultCode: 0, payUrl: 'https://momo.test/pay' } };

    const mine = await member.get<{ data: Order[] }>('/wallet/top-ups?limit=50');
    expect(mine.data.filter((o) => o.provider === 'MOMO' && o.status === 'FAILED').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps each member to their own orders', async () => {
    const created = await order('VNPAY', 10_000);
    await other.get(`/wallet/top-ups/${created.topUpId}`, 404);
    await member.get('/wallet/top-ups/not-a-uuid', 400);
    expect((await other.get<{ data: Order[] }>('/wallet/top-ups')).data).toHaveLength(0);
  });

  it('settles a silent attempt the gateway confirms, and expires what nobody paid', async () => {
    const vnpay = await order('VNPAY', 40_000);
    const momo = await order('MOMO', 40_000);
    const before = await wallet();
    const later = new Date(Date.now() + 20 * 60_000);
    const reconcile = app.get(PaymentReconcileSweep);

    // Nothing confirmed yet: every stale attempt is left for the next run.
    const unsure = await reconcile.reconcileDue(later);
    expect(unsure.settled).toBe(0);

    gateway.vnpayQuery = {
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '14000001',
      vnp_Amount: '4000000',
      vnp_PayDate: '20261009120000',
    };
    gateway.momoStatus = { resultCode: 0, transId: 99001, amount: 40_000, responseTime: Date.now() };
    const outcome = await reconcile.reconcileDue(later);
    expect(outcome.settled).toBeGreaterThanOrEqual(2);
    expect(await member.get<Order>(`/wallet/top-ups/${vnpay.topUpId}`)).toMatchObject({ status: 'PAID' });
    expect(await member.get<Order>(`/wallet/top-ups/${momo.topUpId}`)).toMatchObject({ status: 'PAID' });
    expect((await wallet()).mainBalance).toBe(before.mainBalance + 80);

    gateway.vnpayQuery = { vnp_ResponseCode: '91' };
    gateway.momoStatus = { resultCode: 1000 };
    const stale = await order('VNPAY', 10_000);
    expect(await app.get(TopUpExpirySweep).expireDue(new Date(Date.now() + 60 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(await member.get<Order>(`/wallet/top-ups/${stale.topUpId}`)).toMatchObject({ status: 'EXPIRED' });
  });

  it('lists the orders and the ledger entries they wrote', async () => {
    const orders = await member.get<{ data: Order[]; meta: Row }>('/wallet/top-ups?limit=5');
    expect(orders.data.length).toBeLessThanOrEqual(5);
    const statement = await member.get<{ data: Row[] }>('/wallet/statements?limit=50');
    expect(statement.data.length).toBeGreaterThan(0);
    await member.get(`/wallet/transactions/${statement.data[0].id}`);
    await other.get(`/wallet/transactions/${statement.data[0].id}`, 404);
  });
});
