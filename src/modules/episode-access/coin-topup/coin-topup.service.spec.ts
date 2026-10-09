import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, TopUpStatus } from '@prisma/client';
import { TOPUP_REASON } from './coin-topup.service';
import {
  SETTINGS_VALUE,
  catchError,
  createDeps,
  createPrisma,
  createService,
  createTx,
  echoWith,
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
