import { orderView, type OrderRow, type PaymentRow } from './order-view';

describe('orderView', () => {
  const createdAt = new Date('2026-10-27T03:00:00Z');
  const order = {
    id: 't-1',
    amountVnd: 50_000,
    coinsGranted: 50,
    rateVnd: 1000,
    status: 'PENDING',
    failureReason: null,
    expiresAt: new Date('2026-10-27T03:15:00Z'),
    createdAt,
  } as unknown as OrderRow;

  it('dates the order by when it was placed, so a pending one shows in the history', () => {
    expect(orderView(order, null)).toMatchObject({ topUpId: 't-1', status: 'PENDING', paidAt: null, createdAt });
  });

  it('takes the gateway fields from the newest attempt', () => {
    const payment = { provider: 'VNPAY', redirectUrl: 'https://pay', paidAt: null } as unknown as PaymentRow;
    expect(orderView(order, payment)).toMatchObject({ provider: 'VNPAY', redirectUrl: 'https://pay' });
  });
});
