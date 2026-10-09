import { UnprocessableEntityException } from '@nestjs/common';
import { PaymentStatus, TopUpStatus } from '@prisma/client';
import { TOPUP_REASON } from './coin-topup.service';
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
