import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import { noticeAdjusted, noticeReceived, noticeSpent } from './coin-notices';

describe('coin notices', () => {
  const tx = {
    coinWallet: { findUniqueOrThrow: jest.fn().mockResolvedValue({ userId: 'u1' }) },
  } as unknown as PrismaTx;
  const notify = jest.fn();
  const notifications = { notify } as unknown as NotificationService;
  beforeEach(() => notify.mockClear());

  it('reports a spend main Coins first, and warns once the wallet drops under 10 Coin', async () => {
    await noticeSpent(notifications, tx, 'w1', 'EPISODE_PURCHASE', {
      transactionId: 't1',
      mainCoins: 2,
      bonusCoins: 1,
      mainBalance: 0,
      bonusBalance: 7,
    });
    expect(notify).toHaveBeenNthCalledWith(
      1,
      ['u1'],
      expect.objectContaining({
        type: 'COIN_SPENT',
        title: 'Đã trừ 3 Coin để mở khoá một tập phim',
        body: expect.stringContaining('2 Coin chính + 1 Coin thưởng'),
      }),
      tx,
    );
    expect(notify).toHaveBeenNthCalledWith(2, ['u1'], expect.objectContaining({ type: 'COIN_LOW_BALANCE' }), tx);
  });

  it('does not warn again when the wallet was already low', async () => {
    await noticeSpent(notifications, tx, 'w1', 'EPISODE_PURCHASE', {
      transactionId: 't',
      mainCoins: 1,
      bonusCoins: 0,
      mainBalance: 3,
      bonusBalance: 0,
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('reports a daily reward but leaves top-ups to their own notice', async () => {
    const m = { transactionId: 't', mainCoins: 0, bonusCoins: 5, mainBalance: 0, bonusBalance: 5 };
    await noticeReceived(notifications, tx, 'w1', 'DAILY_REWARD', m);
    await noticeReceived(notifications, tx, 'w1', 'TOP_UP', m);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(['u1'], expect.objectContaining({ type: 'COIN_RECEIVED' }), tx);
  });

  it('tells the member what the Admin corrected and why', async () => {
    await noticeAdjusted(notifications, tx, 'w1', 'Hoàn tiền lỗi phát', {
      transactionId: 't',
      mainCoins: 4,
      bonusCoins: 0,
      mainBalance: 9,
      bonusBalance: 0,
    });
    expect(notify).toHaveBeenCalledWith(
      ['u1'],
      expect.objectContaining({ type: 'COIN_ADJUSTED', title: 'Admin cộng 4 Coin chính' }),
      tx,
    );
  });
});
