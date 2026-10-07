import { BadRequestException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, Prisma, TopUpStatus } from '@prisma/client';
import { TOPUP_REASON } from './coin-topup.service';
import { buildVnpayPayUrl, verifyVnpaySignature } from './gateways/vnpay-signing';
import {
  MOVEMENT,
  catchError,
  createDeps,
  createPrisma,
  createService,
  createTx,
  echoWith,
  pendingOrder,
  pendingPayment,
} from './coin-topup.fixtures';

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
    const deps = {
      gateways: {
        verifyCallbackSignature: jest.fn<boolean, [PaymentProvider, Record<string, unknown>]>(),
      },
      coins: {
        credit: jest.fn(),
      },
    };
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
    const gateways = deps.gateways as {
      verifyCallbackSignature: jest.MockedFunction<
        (provider: PaymentProvider, delivery: Record<string, unknown>) => boolean
      >;
    };

    gateways.verifyCallbackSignature.mockReturnValue(false);
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
    const gateways = deps.gateways as unknown as {
      verifyCallbackSignature: jest.Mock<boolean, [unknown, Record<string, unknown>]>;
    };
    gateways.verifyCallbackSignature.mockImplementation((_provider: unknown, raw: Record<string, unknown>) =>
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
    (
      deps.gateways as unknown as {
        verifyCallbackSignature: {
          mockReturnValue(value: boolean): void;
        };
      }
    ).verifyCallbackSignature.mockReturnValue(false);

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
