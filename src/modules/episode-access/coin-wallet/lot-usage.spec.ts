import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { bonusOf, consumeLots } from './lot-usage';

describe('bonusOf', () => {
  it('sums what is left in the lots', () => {
    expect(bonusOf([{ remainingAmount: 10 }, { remainingAmount: 0 }, { remainingAmount: 25 }])).toBe(35);
  });

  it('is zero when there is nothing to sum', () => {
    expect(bonusOf([])).toBe(0);
  });
});

describe('consumeLots', () => {
  const txOf = () => ({ coinLot: { update: jest.fn().mockResolvedValue({}) } });
  const now = new Date('2026-10-05T00:00:00.000Z');

  it('takes from the lots in order and closes the drained one', async () => {
    const tx = txOf();
    const debits = await consumeLots(
      tx as unknown as PrismaTx,
      [
        { id: 'lot-a', remainingAmount: 5 },
        { id: 'lot-b', remainingAmount: 10 },
      ],
      7,
      now,
    );

    expect(debits).toEqual([
      { id: 'lot-a', amount: 5 },
      { id: 'lot-b', amount: 2 },
    ]);
    expect(tx.coinLot.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'lot-a' },
      data: { remainingAmount: 0, closedAt: now },
    });
    expect(tx.coinLot.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'lot-b' },
      data: { remainingAmount: 8, closedAt: null },
    });
  });

  it('touches nothing when there is nothing to take', async () => {
    const tx = txOf();
    await expect(
      consumeLots(tx as unknown as PrismaTx, [{ id: 'lot-a', remainingAmount: 5 }], 0, now),
    ).resolves.toEqual([]);
    expect(tx.coinLot.update).not.toHaveBeenCalled();
  });

  it('closes the lot on an exact drain', async () => {
    const tx = txOf();
    const debits = await consumeLots(tx as unknown as PrismaTx, [{ id: 'lot-a', remainingAmount: 5 }], 5, now);
    expect(debits).toEqual([{ id: 'lot-a', amount: 5 }]);
    expect(tx.coinLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-a' },
      data: { remainingAmount: 0, closedAt: now },
    });
  });
});
