import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider, Prisma, TopUpStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import type { CoinSpendService } from '../coin-wallet/coin-spend.service';
import type { WalletService } from '../coin-wallet/wallet.service';
import { CoinTopUpService, TOPUP_REASON } from './coin-topup.service';

describe('CoinTopUpService.create', () => {
  const prisma = { coinTopUp: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() } };
  const wallets = { walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const settings = {
    get: jest.fn().mockResolvedValue({ coinTopUpMinVnd: 10000, coinTopUpMaxVnd: 2000000, coinRateVnd: 1000 }),
  };
  const service = new CoinTopUpService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    wallets as unknown as WalletService,
    settings as unknown as PlatformSettingService,
    {} as unknown as NotificationService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    settings.get.mockResolvedValue({ coinTopUpMinVnd: 10000, coinTopUpMaxVnd: 2000000, coinRateVnd: 1000 });
    wallets.walletOf.mockResolvedValue({ id: 'w1' });
    prisma.coinTopUp.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: 'topup-1',
      ...data,
    }));
  });

  it('opens a PENDING order with the Coins rounded down and a gateway order id (step 12)', async () => {
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
    expect(prisma.coinTopUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', walletId: 'w1', provider: PaymentProvider.VNPAY }),
      select: expect.anything(),
    });
  });

  it('points MoMo orders at the MoMo sandbox', async () => {
    const order = await service.create('u1', PaymentProvider.MOMO, 50000);
    expect(order.redirectUrl).toContain('test-payment.momo.vn');
  });

  it.each([9999, 2000001])('refuses %s VND as outside the platform range', async (amountVnd) => {
    let error: unknown;

    try {
      await service.create('u1', PaymentProvider.VNPAY, amountVnd);
    } catch (e: unknown) {
      error = e;
    }

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

    expect(prisma.coinTopUp.create).not.toHaveBeenCalled();
  });

  it('answers 404 for somebody else’s order id', async () => {
    prisma.coinTopUp.findFirst.mockResolvedValue(null);
    await expect(service.findMine('u1', 'missing')).rejects.toThrow(NotFoundException);
  });
});

describe('CoinTopUpService.settle', () => {
  const tx = { coinTopUp: { findUniqueOrThrow: jest.fn(), update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    coinTopUp: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    paymentCallback: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new CoinTopUpService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
  );

  const order = {
    id: 'topup-1',
    userId: 'u1',
    walletId: 'w1',
    provider: PaymentProvider.VNPAY,
    amountVnd: 50000,
    coinsGranted: 50,
    rateVnd: 1000,
    status: TopUpStatus.PENDING,
  };
  const movement = { transactionId: 'tx-1', mainCoins: 50, bonusCoins: 0, mainBalance: 50, bonusBalance: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    tx.coinTopUp.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...order, ...data }));
    coins.credit.mockResolvedValue(movement);
  });

  it('credits main Coins once, then marks the order PAID and tells the member', async () => {
    const settled = await service.settle({
      topUpId: 'topup-1',
      providerPaymentId: 'gw-1',
      amountVnd: 50000,
      idempotencyKey: 'topup:topup-1',
    });

    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ entryType: 'TOP_UP', mainAmount: 50, referenceId: 'topup-1' }),
      undefined,
    );
    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({ status: TopUpStatus.PAID, providerPaymentId: 'gw-1', coinTransactionId: 'tx-1' }),
      select: expect.anything(),
    });
    expect(notifications.notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ link: '/wallet' }), tx);
    expect(settled).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID });
  });

  it('reports a paid order instead of crediting again', async () => {
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue({
      ...order,
      status: TopUpStatus.PAID,
    });

    let error: unknown;

    try {
      await service.settle({
        topUpId: 'topup-1',
        providerPaymentId: 'gw-1',
        amountVnd: 50000,
        idempotencyKey: 'k',
      });
    } catch (e: unknown) {
      error = e;
    }

    expect(error).toBeInstanceOf(UnprocessableEntityException);

    if (!(error instanceof UnprocessableEntityException)) {
      throw new Error('Expected UnprocessableEntityException');
    }

    expect(error.getResponse()).toMatchObject({
      details: {
        reason: TOPUP_REASON.ALREADY_SETTLED,
      },
    });

    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('refuses orders that are no longer payable', async () => {
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue({
      ...order,
      status: TopUpStatus.EXPIRED,
    });

    await expect(
      service.settle({
        topUpId: 'topup-1',
        providerPaymentId: 'gw-1',
        amountVnd: 50000,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({
      response: {
        details: {
          reason: TOPUP_REASON.NOT_PAYABLE,
        },
      },
    });

    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('fails the order when the gateway reports another amount', async () => {
    await expect(
      service.settle({
        topUpId: 'topup-1',
        providerPaymentId: 'gw-1',
        amountVnd: 40000,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 422,
        details: {
          reason: TOPUP_REASON.AMOUNT_MISMATCH,
        },
      },
    });

    expect(tx.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({
        status: TopUpStatus.FAILED,
      }),
    });

    expect(coins.credit).not.toHaveBeenCalled();
  });
});

describe('CoinTopUpService.handleCallback', () => {
  const tx = { coinTopUp: { findUniqueOrThrow: jest.fn(), update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
    coinTopUp: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    paymentCallback: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const coins = { spend: jest.fn(), credit: jest.fn() };
  const notifications = { notify: jest.fn() };
  const service = new CoinTopUpService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    notifications as unknown as NotificationService,
  );

  const order = {
    id: 'topup-1',
    userId: 'u1',
    walletId: 'w1',
    provider: PaymentProvider.VNPAY,
    providerTxnId: 'VNPAY-ABC',
    amountVnd: 50000,
    coinsGranted: 50,
    rateVnd: 1000,
    status: TopUpStatus.PENDING,
  };
  const movement = { transactionId: 'tx-1', mainCoins: 50, bonusCoins: 0, mainBalance: 50, bonusBalance: 0 };
  const delivery = {
    eventId: 'evt-1',
    topUpId: 'topup-1',
    amountVnd: 50000,
    status: 'success',
    providerPaymentId: 'gw-1',
    signature: 'sig',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.paymentCallback.findUnique.mockResolvedValue(null);
    prisma.coinTopUp.findFirst.mockResolvedValue(order);
    prisma.paymentCallback.create.mockResolvedValue({ id: 'cb-1' });
    prisma.paymentCallback.update.mockResolvedValue({ id: 'cb-1' });
    prisma.coinTopUp.findUnique.mockResolvedValue({ ...order, status: TopUpStatus.PAID });
    tx.coinTopUp.findUniqueOrThrow.mockResolvedValue(order);
    tx.coinTopUp.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...order, ...data }));
    coins.credit.mockResolvedValue(movement);
  });

  it('settles a success delivery and records it by (provider, event_id)', async () => {
    const settled = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery });

    expect(prisma.paymentCallback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: PaymentProvider.VNPAY, eventId: 'evt-1', signature: 'sig' }),
    });
    expect(settled).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID });
    expect(prisma.paymentCallback.update).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: PaymentProvider.VNPAY, eventId: 'evt-1' } },
      data: expect.objectContaining({ handledAt: expect.any(Date) }),
    });
  });

  it('answers a repeated delivery with the same order and credits nothing twice', async () => {
    prisma.paymentCallback.findUnique.mockResolvedValue({ topUpId: 'topup-1', handledAt: new Date() });

    const again = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery });

    expect(again).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID });
    expect(prisma.paymentCallback.create).not.toHaveBeenCalled();
    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('marks the order failed when the gateway reports a failure', async () => {
    const failed = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery, status: 'failed' });

    expect(prisma.coinTopUp.update).toHaveBeenCalledWith({
      where: { id: 'topup-1' },
      data: expect.objectContaining({ status: TopUpStatus.FAILED }),
    });
    expect(coins.credit).not.toHaveBeenCalled();
    expect(failed).toMatchObject({ topUpId: 'topup-1' });
  });

  it('refuses a delivery with no signature at all', async () => {
    const { signature: _dropped, ...unsigned } = delivery;

    await expect(service.handleCallback(PaymentProvider.VNPAY, unsigned)).rejects.toMatchObject({
      response: {
        statusCode: 400,
        details: {
          reason: TOPUP_REASON.MISSING_SIGNATURE,
        },
      },
    });
  });

  it('reads VNPay IPN fields, down to the amount times 100', async () => {
    prisma.coinTopUp.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      where.providerTxnId ? order : null,
    );

    const settled = await service.handleCallback(PaymentProvider.VNPAY, {
      vnp_TxnRef: 'VNPAY-ABC',
      vnp_TransactionNo: 'evt-vnp-1',
      vnp_Amount: '5000000',
      vnp_ResponseCode: '00',
      vnp_SecureHash: 'sig',
    });

    expect(settled).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID });
  });

  it('lets the winner of a raced delivery finish while answering the same order', async () => {
    prisma.paymentCallback.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
    );
    prisma.paymentCallback.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ topUpId: 'topup-1', handledAt: new Date() });

    const settled = await service.handleCallback(PaymentProvider.VNPAY, { ...delivery });

    expect(settled).toMatchObject({ topUpId: 'topup-1', status: TopUpStatus.PAID });
    expect(coins.credit).not.toHaveBeenCalled();
  });
});

describe('CoinTopUpService.findForReturn', () => {
  const prisma = {
    $transaction: jest.fn(),
    coinTopUp: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    paymentCallback: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const service = new CoinTopUpService(
    prisma as unknown as PrismaService,
    {} as unknown as CoinSpendService,
    {} as unknown as WalletService,
    {} as unknown as PlatformSettingService,
    {} as unknown as NotificationService,
  );

  const order = {
    id: '11111111-1111-4111-8111-111111111111',
    provider: PaymentProvider.MOMO,
    status: TopUpStatus.PAID,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.coinTopUp.findFirst.mockResolvedValue(order);
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
    await expect(
      service.findForReturn(PaymentProvider.MOMO, {
        topUpId: 'not-a-uuid',
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        details: {
          reason: TOPUP_REASON.INVALID_CALLBACK,
        },
      },
    });
  });

  it('needs at least one reference', async () => {
    await expect(service.findForReturn(PaymentProvider.MOMO, {})).rejects.toThrow(BadRequestException);
  });

  it('answers 404 when the order belongs to nobody', async () => {
    prisma.coinTopUp.findFirst.mockResolvedValue(null);
    await expect(service.findForReturn(PaymentProvider.MOMO, { topUpId: order.id })).rejects.toThrow(NotFoundException);
  });
});
