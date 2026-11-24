import { NotFoundException } from '@nestjs/common';
import { CoinEntryType, CoinLotSource, CycleStatus } from '@prisma/client';
import type { PrismaService, PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { CoinRefundService } from './coin-refund.service';
import type { CoinSpendService } from './coin-spend.service';

type Row = {
  id: string;
  walletId: string;
  entryType: CoinEntryType;
  mainAmount: number;
  bonusAmount: number;
  lotId: string | null;
  paymentId: string | null;
};

/** One episode bought with 10 main Coins and 15 bonus Coins taken from two lots. */
const head: Row = {
  id: 'pay-1',
  walletId: 'w1',
  entryType: CoinEntryType.EPISODE_PURCHASE,
  mainAmount: -10,
  bonusAmount: 0,
  lotId: null,
  paymentId: 'pay-1',
};
const lotRows: Row[] = [
  { ...head, id: 'pay-1-lot-a', mainAmount: 0, bonusAmount: -5, lotId: 'lot-a' },
  { ...head, id: 'pay-1-lot-b', mainAmount: 0, bonusAmount: -10, lotId: 'lot-b' },
];

describe('CoinRefundService', () => {
  let ledger: Row[];
  let refunds: { id: string; reversesId: string; mainAmount: number; bonusAmount: number }[];
  const tx = {
    $queryRaw: jest.fn(),
    coinTransaction: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => ledger.find((r) => r.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => ledger.find((r) => r.id === where.id)),
      findMany: jest.fn(({ where }: { where: { OR: [{ id: string }, { paymentId: string }] } }) =>
        ledger.filter((r) => r.id === where.OR[0].id || r.paymentId === where.OR[1].paymentId),
      ),
      findFirst: jest.fn(
        ({ where }: { where: { reversesId: { in: string[] } } }) =>
          refunds.find((r) => where.reversesId.in.includes(r.reversesId)) ?? null,
      ),
    },
    coinWallet: { findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'u1' }) },
    episodeAccess: { findUnique: jest.fn(), updateMany: jest.fn() },
    subscriptionCycle: { findUnique: jest.fn(), update: jest.fn() },
    subscription: { updateMany: jest.fn() },
  };
  const coins = { credit: jest.fn() };
  const auditLog = { record: jest.fn() };
  const notifications = { notify: jest.fn() };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const service = new CoinRefundService(
    prisma as unknown as PrismaService,
    coins as unknown as CoinSpendService,
    auditLog as unknown as AuditLogService,
    notifications as unknown as NotificationService,
  );
  const request = { description: 'why', revokeReason: 'ADMIN_REFUND' };
  const refundPayment = (id: string) => service.refundPayment(tx as unknown as PrismaTx, id, request);

  beforeEach(() => {
    jest.clearAllMocks();
    ledger = [head, ...lotRows];
    refunds = [];
    tx.episodeAccess.findUnique.mockResolvedValue({ id: 'access-1', paidCoins: 25 });
    tx.subscriptionCycle.findUnique.mockResolvedValue(null);
    tx.subscription.updateMany.mockResolvedValue({ count: 1 });
    // The credit writes the REFUND row the next attempt will find.
    coins.credit.mockImplementation(
      (_tx, _wallet, credit: { reversesId: string; mainAmount: number; bonusAmount: number }) => {
        refunds.push({ id: 'refund-1', ...credit });
        return { transactionId: 'refund-1', mainBalance: 10, bonusBalance: 15 };
      },
    );
  });

  it('pays the whole payment back once: main to main, bonus as a refund lot, pointing at its first row', async () => {
    const refund = await refundPayment('pay-1');

    expect(refund).toMatchObject({ paymentId: 'pay-1', alreadyRefunded: false, mainCoins: 10, bonusCoins: 15 });
    expect(coins.credit).toHaveBeenCalledTimes(1);
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({
        entryType: CoinEntryType.REFUND,
        mainAmount: 10,
        bonusAmount: 15,
        lotSource: CoinLotSource.REFUND,
        reversesId: 'pay-1',
        referenceType: 'EPISODE_ACCESS',
        referenceId: 'access-1',
      }),
      expect.any(Date),
    );
    expect(tx.episodeAccess.updateMany).toHaveBeenCalledWith({
      where: { id: 'access-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: 'ADMIN_REFUND' },
    });
  });

  it('refunds the whole payment when asked with one of its bonus lot rows', async () => {
    const refund = await refundPayment('pay-1-lot-b');

    expect(refund).toMatchObject({ paymentId: 'pay-1', mainCoins: 10, bonusCoins: 15 });
    expect(coins.credit).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ reversesId: 'pay-1' }),
      expect.any(Date),
    );
  });

  it.each([
    ['main Coins only (no lot)', [{ ...head, mainAmount: -25 }], 25, 0],
    ['all bonus Coins (empty main row)', [{ ...head, mainAmount: 0 }, ...lotRows], 0, 15],
  ])('pays back a payment of %s as it was paid', async (_case, rows, main, bonus) => {
    ledger = rows;
    tx.episodeAccess.findUnique.mockResolvedValue({ id: 'access-1', paidCoins: main + bonus });

    await expect(refundPayment('pay-1')).resolves.toMatchObject({ mainCoins: main, bonusCoins: bonus });
  });

  it('pays the bonus part from the price kept on the unlock when its lot rows were never linked', async () => {
    ledger = [head];

    await expect(refundPayment('pay-1')).resolves.toMatchObject({ mainCoins: 10, bonusCoins: 15 });
  });

  it('finds an earlier refund of any row of the payment and moves nothing again', async () => {
    refunds = [{ id: 'old-refund', reversesId: 'pay-1-lot-a', mainAmount: 0, bonusAmount: 5 }];

    await expect(refundPayment('pay-1')).resolves.toMatchObject({
      alreadyRefunded: true,
      refundTransactionId: 'old-refund',
      mainBalance: null,
    });
    expect(coins.credit).not.toHaveBeenCalled();
    expect(tx.episodeAccess.updateMany).not.toHaveBeenCalled();
  });

  it('checks for an earlier refund only under the wallet lock, so a concurrent refund that waited pays nothing', async () => {
    // The database lock makes the second attempt run after the first committed; it then sees its row.
    const first = await refundPayment('pay-1');
    const second = await refundPayment('pay-1-lot-a');

    expect([first.alreadyRefunded, second.alreadyRefunded]).toEqual([false, true]);
    expect(second.refundTransactionId).toBe(first.refundTransactionId);
    expect(coins.credit).toHaveBeenCalledTimes(1);
    const [lock] = tx.$queryRaw.mock.invocationCallOrder;
    const [check] = tx.coinTransaction.findFirst.mock.invocationCallOrder;
    expect(lock).toBeLessThan(check);
  });

  it('refuses a bonus row that could not be linked to its payment', async () => {
    ledger = [{ ...lotRows[0], paymentId: null }];

    await expect(refundPayment('pay-1-lot-a')).rejects.toMatchObject({
      response: { details: { reason: 'PAYMENT_NOT_LINKED' } },
    });
  });

  it.each([
    { entryType: CoinEntryType.TOP_UP, mainAmount: 50, bonusAmount: 0 },
    { entryType: CoinEntryType.REFUND, mainAmount: 10, bonusAmount: 0 },
    { entryType: CoinEntryType.ADJUSTMENT, mainAmount: -10, bonusAmount: 0 },
  ])('refuses to refund $entryType moving $mainAmount/$bonusAmount', async (row) => {
    ledger = [{ ...head, ...row, paymentId: null }];

    await expect(refundPayment('pay-1')).rejects.toMatchObject({ response: { details: { reason: 'NOT_REFUNDABLE' } } });
    expect(coins.credit).not.toHaveBeenCalled();
  });

  it('answers an unknown row with 404', async () => {
    await expect(refundPayment('missing')).rejects.toThrow(NotFoundException);
  });

  describe('a plan payment', () => {
    const cycle = (periodEnd: Date) => ({ id: 'cycle-1', priceCoins: 300, periodEnd, subscriptionId: 'sub-1' });

    beforeEach(() => {
      ledger = [{ ...head, entryType: CoinEntryType.PLAN_PAYMENT, mainAmount: -300 }];
    });

    it('marks the cycle REFUNDED and ends the plan whose period it paid for', async () => {
      tx.subscriptionCycle.findUnique.mockResolvedValue(cycle(new Date(Date.now() + 86_400_000)));

      const refund = await refundPayment('pay-1');

      expect(refund).toMatchObject({ mainCoins: 300, subscriptionCycleId: 'cycle-1', subscriptionEnded: true });
      expect(coins.credit).toHaveBeenCalledWith(
        tx,
        'w1',
        expect.objectContaining({ referenceType: 'SUBSCRIPTION_CYCLE', referenceId: 'cycle-1' }),
        expect.any(Date),
      );
      expect(tx.subscriptionCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: CycleStatus.REFUNDED },
      });
      expect(tx.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-1', status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE'] } },
        data: expect.objectContaining({ status: 'CANCELLED', endReason: 'CANCELLED_BY_ADMIN', autoRenew: false }),
      });
    });

    it('leaves the plan alone when the refunded cycle is already over', async () => {
      tx.subscriptionCycle.findUnique.mockResolvedValue(cycle(new Date(Date.now() - 86_400_000)));

      await expect(refundPayment('pay-1')).resolves.toMatchObject({ subscriptionEnded: false });
      expect(tx.subscription.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('refundByAdmin', () => {
    it('refunds, records who did it and tells the member', async () => {
      const answer = await service.refundByAdmin('pay-1-lot-a', 'admin-1');

      expect(answer).toMatchObject({ transactionId: 'refund-1', paymentId: 'pay-1', mainCoins: 10, bonusCoins: 15 });
      expect(coins.credit).toHaveBeenCalledWith(
        tx,
        'w1',
        expect.objectContaining({ createdById: 'admin-1' }),
        expect.any(Date),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: CONTENT_EVENT.COIN_REFUNDED, entityId: 'pay-1', actorId: 'admin-1' }),
        tx,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        ['u1'],
        expect.objectContaining({ title: 'Đã hoàn 25 Coin', link: '/wallet' }),
        tx,
      );
    });

    it.each([
      ['a second Admin refund', 'pay-1'],
      ['a refund after the episode was taken down and paid back', 'pay-1-lot-b'],
    ])('answers %s with 409 ALREADY_REFUNDED', async (_case, id) => {
      refunds = [{ id: 'refund-0', reversesId: 'pay-1', mainAmount: 10, bonusAmount: 15 }];

      await expect(service.refundByAdmin(id, 'admin-1')).rejects.toMatchObject({
        status: 409,
        response: { details: { reason: 'ALREADY_REFUNDED', paymentId: 'pay-1', refundTransactionId: 'refund-0' } },
      });
      expect(coins.credit).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
