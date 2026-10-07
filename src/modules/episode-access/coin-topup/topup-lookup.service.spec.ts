import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, TopUpStatus } from '@prisma/client';
import { TOPUP_REASON } from './coin-topup.service';
import { createDeps, createPrisma, createService, createTx } from './coin-topup.fixtures';

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
