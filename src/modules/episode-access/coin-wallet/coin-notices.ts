import { CoinEntryType } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import type { NotificationService } from 'src/modules/platform/notification/notification.service';
import type { CoinMovement, PaymentRefund } from './coin-wallet.types';

/** Below this many Coins in all, the member is told the wallet is running low. */
const LOW_BALANCE_COINS = 10;

const SPENT_FOR: Partial<Record<CoinEntryType, string>> = {
  EPISODE_PURCHASE: 'mở khoá một tập phim',
  PLAN_PAYMENT: 'mua gói thành viên',
  PLAN_RENEWAL: 'gia hạn gói thành viên',
};

const RECEIVED_FOR: Partial<Record<CoinEntryType, string>> = {
  DAILY_REWARD: 'điểm danh hằng ngày',
  SIGNUP_BONUS: 'quà chào mừng thành viên mới',
};

const coins = (main: number, bonus: number) =>
  [main ? `${Math.abs(main)} Coin chính` : null, bonus ? `${Math.abs(bonus)} Coin thưởng` : null]
    .filter(Boolean)
    .join(' + ');

const balance = (m: CoinMovement) => `Số dư: ${m.mainBalance} Coin chính, ${m.bonusBalance} Coin thưởng.`;

async function ownerOf(tx: PrismaTx, walletId: string): Promise<string> {
  return (await tx.coinWallet.findUniqueOrThrow({ where: { id: walletId }, select: { userId: true } })).userId;
}

/** Every Coin taken out of a wallet is reported, in the order main then bonus (BR-01), with a low-balance warning. */
export async function noticeSpent(
  notifications: NotificationService | undefined,
  tx: PrismaTx,
  walletId: string,
  entryType: CoinEntryType,
  m: CoinMovement,
): Promise<void> {
  if (!notifications) return;
  const userId = await ownerOf(tx, walletId);
  const total = m.mainCoins + m.bonusCoins;
  await notifications.notify(
    [userId],
    {
      type: NOTIFICATION_TYPE.COIN_SPENT,
      title: `Đã trừ ${total} Coin để ${SPENT_FOR[entryType] ?? 'thanh toán'}`,
      body: `Dùng ${coins(m.mainCoins, m.bonusCoins)}. ${balance(m)}`,
      link: '/wallet',
      payload: { transactionId: m.transactionId, mainCoins: m.mainCoins, bonusCoins: m.bonusCoins },
    },
    tx,
  );
  const after = m.mainBalance + m.bonusBalance;
  if (after < LOW_BALANCE_COINS && after + total >= LOW_BALANCE_COINS) {
    await notifications.notify(
      [userId],
      {
        type: NOTIFICATION_TYPE.COIN_LOW_BALANCE,
        title: `Ví chỉ còn ${after} Coin`,
        body: 'Nạp thêm Coin để tiếp tục mở khoá tập phim.',
        link: '/wallet',
        payload: { balance: after },
      },
      tx,
    );
  }
}

/** Coins that land without a notice of their own (top-up, spin and refund already have one). */
export async function noticeReceived(
  notifications: NotificationService | undefined,
  tx: PrismaTx,
  walletId: string,
  entryType: CoinEntryType,
  m: CoinMovement,
): Promise<void> {
  const reason = RECEIVED_FOR[entryType];
  if (!notifications || !reason) return;
  await notifications.notify(
    [await ownerOf(tx, walletId)],
    {
      type: NOTIFICATION_TYPE.COIN_RECEIVED,
      title: `Bạn nhận ${coins(m.mainCoins, m.bonusCoins)} từ ${reason}`,
      body: balance(m),
      link: '/wallet',
      payload: { transactionId: m.transactionId },
    },
    tx,
  );
}

/** The Admin corrected the wallet: the member sees by how much and why. */
export async function noticeAdjusted(
  notifications: NotificationService | undefined,
  tx: PrismaTx,
  walletId: string,
  reason: string,
  m: CoinMovement,
): Promise<void> {
  if (!notifications) return;
  const added = m.mainCoins + m.bonusCoins > 0;
  await notifications.notify(
    [await ownerOf(tx, walletId)],
    {
      type: NOTIFICATION_TYPE.COIN_ADJUSTED,
      title: `${added ? 'Admin cộng' : 'Admin trừ'} ${coins(m.mainCoins, m.bonusCoins)}`,
      body: `Lý do: ${reason}. ${balance(m)}`,
      link: '/wallet',
      payload: { transactionId: m.transactionId },
    },
    tx,
  );
}

/** The Admin refunded a payment: the member sees what came back, and what they no longer have. */
export async function noticeRefunded(
  notifications: NotificationService | undefined,
  tx: PrismaTx,
  refund: PaymentRefund,
): Promise<void> {
  if (!notifications) return;
  const lost = [
    refund.episodeAccessId ? 'Tập phim đã mua được khoá lại.' : null,
    refund.subscriptionEnded ? 'Gói thành viên đã kết thúc.' : null,
  ].filter(Boolean);
  const after = `Số dư: ${refund.mainBalance} Coin chính, ${refund.bonusBalance} Coin thưởng.`;
  await notifications.notify(
    [await ownerOf(tx, refund.walletId)],
    {
      type: NOTIFICATION_TYPE.COIN_RECEIVED,
      title: `Đã hoàn ${refund.mainCoins + refund.bonusCoins} Coin`,
      body: [
        `Quản trị viên đã hoàn ${coins(refund.mainCoins, refund.bonusCoins)} đã dùng để ${SPENT_FOR[refund.entryType] ?? 'thanh toán'}.`,
        ...lost,
        after,
      ].join(' '),
      link: '/wallet',
      payload: { transactionId: refund.refundTransactionId, paymentId: refund.paymentId },
    },
    tx,
  );
}
