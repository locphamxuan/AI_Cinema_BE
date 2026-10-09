import { UnprocessableEntityException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { TOPUP_REASON } from './constants/topup-reason';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { CoinTopUpService } from './coin-topup.service';
import type { PaymentGatewayService } from './gateways/payment-gateway.service';
import { PaymentReconcileSweep } from './payment-reconcile.sweep';

describe('PaymentReconcileSweep.reconcileDue', () => {
  const prisma = { payment: { findMany: jest.fn() } };
  const queue = { every: jest.fn() };
  const topUps = { settle: jest.fn(), markPaymentFailed: jest.fn() };
  const gateways = { reconcilePayment: jest.fn() };
  const config = { schedules: { paymentReconcileSweepMs: 0 } };
  const service = new PaymentReconcileSweep(
    prisma as unknown as PrismaService,
    queue as unknown as JobQueue,
    topUps as unknown as CoinTopUpService,
    gateways as unknown as PaymentGatewayService,
    config as unknown as AppConfig,
  );

  const attempt = {
    id: 'pay-1',
    coinTopUpId: 'topup-1',
    provider: PaymentProvider.MOMO,
    providerTxnId: 'MOMO-ABC',
    amountVnd: 50000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.payment.findMany.mockResolvedValueOnce([attempt]).mockResolvedValue([]);
  });

  it('settles what the gateway confirms, with the webhook’s idempotency key', async () => {
    gateways.reconcilePayment.mockResolvedValue({
      outcome: 'PAID',
      providerPaymentId: '123456',
      amountVnd: 50000,
      paidAt: new Date('2026-10-05T00:00:00.000Z'),
    });

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 1, settled: 1, failed: 0 });
    expect(topUps.settle).toHaveBeenCalledWith({
      paymentId: 'pay-1',
      providerPaymentId: '123456',
      amountVnd: 50000,
      idempotencyKey: 'topup:topup-1',
      paidAt: new Date('2026-10-05T00:00:00.000Z'),
    });
  });

  it('fails what the gateway denies', async () => {
    gateways.reconcilePayment.mockResolvedValue({ outcome: 'FAILED' });

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 1, settled: 0, failed: 1 });
    expect(topUps.markPaymentFailed).toHaveBeenCalledWith('pay-1', expect.any(String), 'FAILED');
    expect(topUps.settle).not.toHaveBeenCalled();
  });

  it('leaves uncertain attempts for the next run', async () => {
    gateways.reconcilePayment.mockResolvedValue({ outcome: 'UNKNOWN' });

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 1, settled: 0, failed: 0 });
    expect(topUps.settle).not.toHaveBeenCalled();
    expect(topUps.markPaymentFailed).not.toHaveBeenCalled();
  });

  it('counts a concurrent webhook settle instead of crashing the batch', async () => {
    gateways.reconcilePayment.mockResolvedValue({ outcome: 'PAID', providerPaymentId: '123', amountVnd: 50000 });
    topUps.settle.mockRejectedValue(
      new UnprocessableEntityException({ message: 'paid', details: { reason: TOPUP_REASON.ALREADY_SETTLED } }),
    );

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 1, settled: 1, failed: 0 });
  });

  it('skips a failing probe and keeps sweeping', async () => {
    gateways.reconcilePayment.mockRejectedValue(new Error('timeout'));

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 1, settled: 0, failed: 0 });
    expect(topUps.settle).not.toHaveBeenCalled();
  });

  it('reports nothing when nothing waits', async () => {
    prisma.payment.findMany.mockReset();
    prisma.payment.findMany.mockResolvedValue([]);

    await expect(service.reconcileDue()).resolves.toEqual({ pending: 0, settled: 0, failed: 0 });
    expect(gateways.reconcilePayment).not.toHaveBeenCalled();
  });
});
