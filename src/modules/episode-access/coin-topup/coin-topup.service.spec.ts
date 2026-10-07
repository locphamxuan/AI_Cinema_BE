import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, Prisma, TopUpStatus } from '@prisma/client';
import { TOPUP_REASON } from './coin-topup.service';
import { buildVnpayPayUrl, verifyVnpaySignature } from './gateways/vnpay-signing';
import {
  MOVEMENT,
  SETTINGS_VALUE,
  catchError,
  createDeps,
  createPrisma,
  createService,
  createTx,
  echoWith,
  pendingOrder,
  pendingPayment,
} from './coin-topup.fixtures';

describe('CoinTopUpService.create', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);

  beforeEach(() => {
    jest.clearAllMocks();
    deps.settings.get.mockResolvedValue(SETTINGS_VALUE);
    deps.wallets.walletOf.mockResolvedValue({ id: 'w1' });
    deps.gateways.createPaymentUrl.mockResolvedValue('https://sandbox.vnpayment.vn/pay?order=VNPAY-ABC');
    tx.coinTopUp.create.mockImplementation(echoWith({ id: 'topup-1', status: TopUpStatus.PENDING }));
    tx.payment.create.mockImplementation(echoWith({ id: 'pay-1', status: PaymentStatus.PENDING }));
    prisma.payment.update.mockImplementation(
      echoWith({
        id: 'pay-1',
        provider: PaymentProvider.VNPAY,
        providerTxnId: 'VNPAY-ABC123',
        status: PaymentStatus.PENDING,
      }),
    );
  });

  it('opens a PENDING order with one PENDING attempt and a gateway order id (step 12)', async () => {
    const order = await service.create('u1', PaymentProvider.VNPAY, 50500);

    expect(order).toMatchObject({
      topUpId: 'topup-1',
      provider: PaymentProvider.VNPAY,
      amountVnd: 50500,
      coinsGranted: 50,
      rateVnd: 1000,
      status: TopUpStatus.PENDING,
    });
    expect(order.providerTxnId).toMatch(/^VNPAY-/);
    expect(order.redirectUrl).toContain('sandbox.vnpayment.vn');
    expect('walletId' in order).toBe(false);
    expect('userId' in order).toBe(false);
    expect(tx.coinTopUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', walletId: 'w1', amountVnd: 50500, coinsGranted: 50 }),
      select: expect.anything(),
    });
    expect(tx.coinTopUp.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ provider: expect.anything(), redirectUrl: expect.anything() }),
      select: expect.anything(),
    });
    expect(tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        coinTopUpId: 'topup-1',
        provider: PaymentProvider.VNPAY,
        amountVnd: 50500,
      }),
      select: expect.anything(),
    });
  });

  it('points MoMo orders at the MoMo sandbox', async () => {
    deps.gateways.createPaymentUrl.mockResolvedValue('https://test-payment.momo.vn/pay/abc');
    prisma.payment.update.mockImplementation(
      echoWith({
        id: 'pay-1',
        provider: PaymentProvider.MOMO,
        providerTxnId: 'MOMO-XYZ',
        status: PaymentStatus.PENDING,
      }),
    );

    const order = await service.create('u1', PaymentProvider.MOMO, 50000);

    expect(deps.gateways.createPaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({ provider: PaymentProvider.MOMO, amountVnd: 50000, topUpId: 'topup-1' }),
    );
    expect(order.redirectUrl).toContain('test-payment.momo.vn');
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { redirectUrl: 'https://test-payment.momo.vn/pay/abc' },
      select: expect.anything(),
    });
  });

  it('forwards the client IP so VNPay can fingerprint the order', async () => {
    await service.create('u1', PaymentProvider.VNPAY, 50000, '203.0.113.7');

    expect(deps.gateways.createPaymentUrl).toHaveBeenCalledWith(
      expect.objectContaining({ provider: PaymentProvider.VNPAY, clientIp: '203.0.113.7' }),
    );
  });

  it('fails the attempt when the gateway gives no payment link', async () => {
    tx.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay-1', coinTopUpId: 'topup-1' });
    deps.gateways.createPaymentUrl.mockRejectedValue(new Error('timeout'));

    await expect(service.create('u1', PaymentProvider.MOMO, 50000)).rejects.toThrow('timeout');
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: PaymentStatus.FAILED }),
    });
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({ status: TopUpStatus.FAILED }),
    });
  });

  it.each([9999, 2000001])('refuses %s VND as outside the platform range', async (amountVnd) => {
    const error = await catchError(service.create('u1', PaymentProvider.VNPAY, amountVnd));

    expect(error).toBeInstanceOf(UnprocessableEntityException);

    if (!(error instanceof UnprocessableEntityException)) {
      throw new Error('Expected UnprocessableEntityException');
    }

    expect(error.getResponse()).toMatchObject({
      details: {
        reason: TOPUP_REASON.AMOUNT_OUT_OF_RANGE,
        coinTopUpMinVnd: 10000,
        coinTopUpMaxVnd: 2000000,
      },
    });

    expect(tx.coinTopUp.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('answers 404 for somebody else’s order id', async () => {
    prisma.coinTopUp.findFirst.mockResolvedValue(null);
    await expect(service.findMine('u1', 'missing')).rejects.toThrow(NotFoundException);
  });
});

describe('CoinTopUpService.settle', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);
  const payment = pendingPayment();
  const order = pendingOrder();

  beforeEach(() => {
    jest.clearAllMocks();
    tx.payment.findUniqueOrThrow.mockResolvedValue(payment);
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    tx.payment.update.mockImplementation(echoWith(payment));
    tx.coinTopUp.update.mockImplementation(echoWith(order));
    deps.coins.credit.mockResolvedValue(MOVEMENT);
  });

  it('credits main Coins once, then marks the attempt and the order PAID and tells the member', async () => {
    const settled = await service.settle({
      paymentId: 'pay-1',
      providerPaymentId: 'gw-1',
      amountVnd: 50000,
      idempotencyKey: 'topup:topup-1',
    });

    expect(deps.coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'TOP_UP', mainAmount: 50, referenceId: 'topup-1' }),
      undefined,
    );
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: PaymentStatus.PAID, providerPaymentId: 'gw-1' }),
      select: expect.anything(),
    });
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({ status: TopUpStatus.PAID, coinTransactionId: 'tx-1' }),
      select: expect.anything(),
    });
    expect(deps.notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
    expect(settled).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID, providerTxnId: 'VNPAY-ABC' });
  });

  it('reports a paid attempt instead of crediting again', async () => {
    tx.payment.findUniqueOrThrow.mockResolvedValue({ ...payment, status: PaymentStatus.PAID });

    const error = await catchError(
      service.settle({ paymentId: 'pay-1', providerPaymentId: 'gw-1', amountVnd: 50000, idempotencyKey: 'k' }),
    );

    expect(error).toBeInstanceOf(UnprocessableEntityException);

    if (!(error instanceof UnprocessableEntityException)) {
      throw new Error('Expected UnprocessableEntityException');
    }

    expect(error.getResponse()).toMatchObject({ details: { reason: TOPUP_REASON.ALREADY_SETTLED } });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('refuses attempts that are no longer payable', async () => {
    tx.payment.findUniqueOrThrow.mockResolvedValue({ ...payment, status: PaymentStatus.EXPIRED });

    await expect(
      service.settle({ paymentId: 'pay-1', providerPaymentId: 'gw-1', amountVnd: 50000, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { details: { reason: TOPUP_REASON.NOT_PAYABLE } } });

    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('refuses to settle when the order itself already died', async () => {
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue({ ...order, status: TopUpStatus.EXPIRED });

    await expect(
      service.settle({ paymentId: 'pay-1', providerPaymentId: 'gw-1', amountVnd: 50000, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ response: { details: { reason: TOPUP_REASON.NOT_PAYABLE } } });

    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('fails the attempt and the order when the gateway reports another amount', async () => {
    await expect(
      service.settle({ paymentId: 'pay-1', providerPaymentId: 'gw-1', amountVnd: 40000, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({
      response: { details: { reason: TOPUP_REASON.AMOUNT_MISMATCH } },
    });

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: PaymentStatus.FAILED }),
    });
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({ status: TopUpStatus.FAILED }),
    });

    expect(deps.coins.credit).not.toHaveBeenCalled();
  });
});

describe('CoinTopUpService.markPaymentFailed', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay-1', coinTopUpId: 'topup-1' });
  });

  it('fails the attempt and mirrors it onto the order', async () => {
    await service.markPaymentFailed('pay-1', 'declined', PaymentStatus.FAILED);

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: PaymentStatus.FAILED, failureReason: 'declined' },
    });
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: { status: TopUpStatus.FAILED, failureReason: 'declined' },
    });
  });
});

describe('CoinTopUpService.handleCallback', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);

  const topUpId = '11111111-1111-4111-8111-111111111111';
  const order = pendingOrder({ id: topUpId });
  const payment = pendingPayment({ id: 'pay-1', coinTopUpId: topUpId });
  const delivery = {
    eventId: 'evt-1',
    topUpId,
    amountVnd: 50000,
    status: 'success',
    providerPaymentId: 'gw-1',
    signature: 'sig',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deps.gateways.verifyCallbackSignature.mockReturnValue(true);
    prisma.paymentCallback.findUnique.mockResolvedValue(null);
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.coinTopUp.findUnique.mockResolvedValue(order);
    prisma.payment.findFirst.mockResolvedValue(payment);
    prisma.paymentCallback.create.mockResolvedValue({ id: 'cb-1' });
    prisma.paymentCallback.update.mockResolvedValue({ id: 'cb-1' });
    tx.payment.findUniqueOrThrow.mockResolvedValue(payment);
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    tx.payment.update.mockImplementation(echoWith(payment));
    tx.coinTopUp.update.mockImplementation(echoWith(order));
    prisma.coinTopUp.update.mockResolvedValue({ ...order, status: TopUpStatus.FAILED });
    deps.coins.credit.mockResolvedValue(MOVEMENT);
  });

  it('settles a success delivery and records it by (provider, event_id)', async () => {
    const settled = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery, providerTxnId: 'VNPAY-ABC' });

    expect(deps.coins.credit).toHaveBeenCalled();
    expect(prisma.paymentCallback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: PaymentProvider.VNPAY,
        eventId: 'evt-1',
        signature: 'sig',
        topUpId,
        paymentId: 'pay-1',
      }),
    });
    expect(settled).toMatchObject({ topUpId, status: TopUpStatus.PAID, providerTxnId: 'VNPAY-ABC' });
    expect(prisma.paymentCallback.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: PaymentProvider.VNPAY, eventId: 'evt-1' } },
      data: expect.objectContaining({ handledAt: expect.any(Date) }),
    });
  });

  it('answers a repeated delivery with the same order and credits nothing twice', async () => {
    prisma.coinTopUp.findUnique.mockResolvedValue({ ...order, status: TopUpStatus.PAID });
    prisma.paymentCallback.findUnique.mockResolvedValue({ topUpId, handledAt: new Date() });

    const again = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery });

    expect(again).toMatchObject({ topUpId, status: TopUpStatus.PAID });
    expect(prisma.paymentCallback.create).not.toHaveBeenCalled();
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('marks the attempt failed when the gateway reports a failure', async () => {
    const failed = await service.handleCallback(PaymentProvider.VNPAY, {
      ...delivery,
      providerTxnId: 'VNPAY-ABC',
      status: 'failed',
    });

    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: expect.objectContaining({ status: PaymentStatus.FAILED }),
    });
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: topUpId },
      data: expect.objectContaining({ status: TopUpStatus.FAILED }),
    });
    expect(deps.coins.credit).not.toHaveBeenCalled();
    expect(failed).toMatchObject({ topUpId });
  });

  it('refuses a delivery whose references point at two different orders', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...payment, id: 'pay-other', coinTopUpId: 'other-topup' });
    await expect(
      service.handleCallback(PaymentProvider.VNPAY, { ...delivery, providerTxnId: 'VNPAY-OTHER' }),
    ).rejects.toMatchObject({
      response: { details: { reason: TOPUP_REASON.INVALID_CALLBACK } },
    });
  });

  it('refuses a delivery with no signature at all', async () => {
    const { signature: _dropped, ...unsigned } = delivery;

    await expect(service.handleCallback(PaymentProvider.VNPAY, unsigned)).rejects.toMatchObject({
      response: { details: { reason: TOPUP_REASON.MISSING_SIGNATURE } },
    });
  });

  it('refuses a delivery with a bad signature before touching the ledger', async () => {
    deps.gateways.verifyCallbackSignature.mockReturnValue(false);

    const error = await catchError(service.handleCallback(PaymentProvider.MOMO, { ...delivery }));

    expect(error).toBeInstanceOf(BadRequestException);

    if (!(error instanceof BadRequestException)) {
      throw new Error('Expected BadRequestException');
    }

    expect(error.getResponse()).toMatchObject({ details: { reason: TOPUP_REASON.INVALID_SIGNATURE } });
    expect(prisma.paymentCallback.upsert).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: PaymentProvider.MOMO, eventId: 'evt-1' } },
      update: expect.objectContaining({ errorMessage: 'Invalid gateway signature' }),
      create: expect.objectContaining({ provider: PaymentProvider.MOMO, eventId: 'evt-1' }),
    });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('recovers the order id from MoMo extraData when topUpId is missing', async () => {
    const { topUpId: _dropped, ...withoutId } = delivery;
    const extraData = Buffer.from(JSON.stringify({ topUpId })).toString('base64');

    const settled = await service.handleCallback(PaymentProvider.MOMO, {
      ...withoutId,
      providerTxnId: 'VNPAY-ABC',
      extraData,
    });

    expect(settled).toMatchObject({ topUpId, status: TopUpStatus.PAID });
  });

  it('reads VNPay IPN fields, down to the amount times 100', async () => {
    prisma.payment.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const key = where.provider_providerTxnId as Record<string, unknown> | undefined;
      return Promise.resolve(key?.providerTxnId ? payment : null);
    });

    const settled = await service.handleCallback(PaymentProvider.VNPAY, {
      vnp_TxnRef: 'VNPAY-ABC',
      vnp_TransactionNo: 'evt-vnp-1',
      vnp_Amount: '5000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_SecureHash: 'sig',
    });

    expect(settled).toMatchObject({ topUpId, status: TopUpStatus.PAID });
  });

  it('treats a VNPay payment without a confirmed transaction status as failed', async () => {
    prisma.payment.findUnique.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      const key = where.provider_providerTxnId as Record<string, unknown> | undefined;
      return Promise.resolve(key?.providerTxnId ? payment : null);
    });
    prisma.coinTopUp.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValue({ ...order, status: TopUpStatus.FAILED });

    const failed = await service.handleCallback(PaymentProvider.VNPAY, {
      vnp_TxnRef: 'VNPAY-ABC',
      vnp_TransactionNo: 'evt-vnp-1',
      vnp_Amount: '5000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '24',
      vnp_SecureHash: 'sig',
    });

    expect(failed).toMatchObject({ topUpId, status: TopUpStatus.FAILED });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('lets the winner of a raced delivery finish while answering the same order', async () => {
    prisma.coinTopUp.findUnique.mockResolvedValue({ ...order, status: TopUpStatus.PAID });
    prisma.paymentCallback.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    prisma.paymentCallback.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ topUpId, handledAt: new Date() });

    const settled = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery, providerTxnId: 'VNPAY-ABC' });

    expect(settled).toMatchObject({ topUpId, status: TopUpStatus.PAID });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });
});

describe('CoinTopUpService.handleVnpayIpn', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);

  const topUpId = '11111111-1111-4111-8111-111111111111';
  const order = pendingOrder({ id: topUpId });
  const payment = pendingPayment({ id: 'pay-1', coinTopUpId: topUpId });

  const vnpQuery = (amount = '5000000', omit: string[] = []) => {
    const params: Record<string, string> = {
      vnp_TmnCode: 'TMN123',
      vnp_Amount: amount,
      vnp_TxnRef: 'VNPAY-ABC',
      vnp_OrderInfo: 'Nap-Coin-VNPAY-ABC',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '987654321',
    };
    for (const key of omit) delete params[key];
    const url = buildVnpayPayUrl('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', params, 'test-secret');
    return Object.fromEntries(new URL(url).searchParams.entries());
  };

  beforeEach(() => {
    jest.clearAllMocks();
    deps.gateways.verifyCallbackSignature.mockImplementation(
      (_provider: unknown, raw: Record<string, unknown>) =>
        verifyVnpaySignature(raw, 'test-secret'),
    );
    prisma.payment.findUnique.mockResolvedValue(payment);
    prisma.coinTopUp.findUnique.mockResolvedValue(order);
    prisma.paymentCallback.findUnique.mockResolvedValue(null);
    prisma.paymentCallback.create.mockResolvedValue({ id: 'cb-1' });
    prisma.paymentCallback.update.mockResolvedValue({ id: 'cb-1' });
    prisma.payment.update.mockResolvedValue(payment);
    prisma.coinTopUp.update.mockResolvedValue(order);
    tx.payment.findUniqueOrThrow.mockResolvedValue(payment);
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    tx.payment.update.mockImplementation(echoWith(payment));
    tx.coinTopUp.update.mockImplementation(echoWith(order));
    deps.coins.credit.mockResolvedValue(MOVEMENT);
  });

  it('answers 97 on a bad checksum without touching the database', async () => {
    deps.gateways.verifyCallbackSignature.mockReturnValue(false);

    await expect(service.handleVnpayIpn(vnpQuery())).resolves.toEqual({
      RspCode: '97',
      Message: 'Invalid checksum',
    });
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('answers 01 for an order VNPay invented', async () => {
    prisma.payment.findUnique.mockResolvedValue(null);

    await expect(service.handleVnpayIpn(vnpQuery())).resolves.toEqual({
      RspCode: '01',
      Message: 'Order not found',
    });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('answers 02 for an already confirmed order without writing', async () => {
    prisma.payment.findUnique.mockResolvedValue({ ...payment, status: PaymentStatus.PAID });

    await expect(service.handleVnpayIpn(vnpQuery())).resolves.toEqual({
      RspCode: '02',
      Message: 'Order already confirmed',
    });
    expect(prisma.paymentCallback.create).not.toHaveBeenCalled();
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('settles a confirmed payment and answers 00', async () => {
    await expect(service.handleVnpayIpn(vnpQuery())).resolves.toEqual({
      RspCode: '00',
      Message: 'Confirm Success',
    });
    expect(deps.coins.credit).toHaveBeenCalled();
  });

  it('answers 04 when the gateway reports another amount', async () => {
    await expect(service.handleVnpayIpn(vnpQuery('4000000'))).resolves.toEqual({
      RspCode: '04',
      Message: 'Invalid amount',
    });
    expect(deps.coins.credit).not.toHaveBeenCalled();
  });

  it('answers 99 on a malformed delivery', async () => {
    await expect(service.handleVnpayIpn(vnpQuery('5000000', ['vnp_Amount']))).resolves.toEqual({
      RspCode: '99',
      Message: 'Invalid request',
    });
  });
});

describe('CoinTopUpService.findForReturn', () => {
  const tx = createTx();
  const prisma = createPrisma(tx);
  const deps = createDeps();
  const service = createService(prisma, deps);

  const order = { id: '11111111-1111-4111-8111-111111111111', status: TopUpStatus.PAID };
  const payment = { id: 'pay-1', provider: PaymentProvider.MOMO, status: PaymentStatus.PAID };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coinTopUp.findUnique.mockResolvedValue(order);
    prisma.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    prisma.payment.findFirst.mockResolvedValue(payment);
    prisma.payment.findUnique.mockResolvedValue({ ...payment, coinTopUpId: order.id });
  });

  it('finds the order by either reference', async () => {
    await expect(service.findForReturn(PaymentProvider.MOMO, { topUpId: order.id })).resolves.toMatchObject({
      topUpId: order.id,
    });
    await expect(service.findForReturn(PaymentProvider.MOMO, { providerTxnId: 'MOMO-X' })).resolves.toMatchObject({
      topUpId: order.id,
    });
  });

  it('refuses a malformed id instead of failing at the database', async () => {
    await expect(service.findForReturn(PaymentProvider.MOMO, { topUpId: 'not-a-uuid' })).rejects.toMatchObject({
      response: { details: { reason: TOPUP_REASON.INVALID_CALLBACK } },
    });
  });

  it('needs at least one reference', async () => {
    await expect(service.findForReturn(PaymentProvider.MOMO, {})).rejects.toThrow(BadRequestException);
  });

  it('answers 404 when the order belongs to nobody', async () => {
    prisma.coinTopUp.findUnique.mockResolvedValue(null);
    await expect(service.findForReturn(PaymentProvider.MOMO, { topUpId: order.id })).rejects.toThrow(NotFoundException);
  });
});
