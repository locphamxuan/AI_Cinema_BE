import { Injectable, NotFoundException } from '@nestjs/common';
import { CoinEntryType, type CoinTransaction, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet.service';

/** Which counter a statement line is about; ALL shows main and bonus together. */
type StatementKind = 'MAIN' | 'BONUS' | 'ALL';

export interface StatementFilter {
  userId: string;
  kind: StatementKind;
  entryType?: CoinEntryType;
  from?: Date;
  to?: Date;
}

/** The admin ledger also narrows to one account and shows it on every row. */
type LedgerFilter = Omit<StatementFilter, 'userId'> & { walletId?: string; account?: string };

const ACCOUNT_SELECT = { id: true, fullName: true, email: true } as const;
type LedgerRow = CoinTransaction & {
  wallet: { userId: string; user: { id: string; fullName: string; email: string } };
};

/** A member whose name or email contains the text, ignoring case. */
const accountMatching = (text: string): Prisma.UserWhereInput => ({
  OR: [{ email: { contains: text, mode: 'insensitive' } }, { fullName: { contains: text, mode: 'insensitive' } }],
});

const lineOf = (entry: CoinTransaction) => ({
  id: entry.id,
  entryType: entry.entryType,
  mainAmount: entry.mainAmount,
  bonusAmount: entry.bonusAmount,
  rateVnd: entry.rateVnd,
  description: entry.description,
  referenceType: entry.referenceType,
  referenceId: entry.referenceId,
  createdAt: entry.createdAt,
  mainBalanceAfter: entry.mainBalanceAfter,
  bonusBalanceAfter: entry.bonusBalanceAfter,
});

/**
 * The transaction history of a wallet, read straight from the ledger. kind picks the counter a
 * member cares about; mainBalanceAfter / bonusBalanceAfter come back with every line, so the
 * screen shows a running balance without replaying anything.
 */
@Injectable()
export class StatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  async history(filter: StatementFilter, query: PaginateQuery) {
    const wallet = await this.wallets.walletOf(filter.userId);
    const page = await paginate(query, this.prisma.coinTransaction, {
      where: this.whereOf(wallet.id, filter),
      sortableColumns: ['createdAt', 'entryType'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { entryType: ['$eq', '$in'] },
    });
    return { ...page, data: page.data.map(lineOf) };
  }

  /** One ledger line with the balances right after it. */
  async line(userId: string, transactionId: string) {
    const wallet = await this.wallets.walletOf(userId);
    const entry = await this.prisma.coinTransaction.findFirst({ where: { id: transactionId, walletId: wallet.id } });
    if (!entry)
      throw new NotFoundException({ message: 'Transaction not found', details: { reason: 'TRANSACTION_NOT_FOUND' } });
    return {
      ...lineOf(entry),
      walletId: wallet.id,
      reversesId: entry.reversesId,
      lotId: entry.lotId,
      paymentId: entry.paymentId,
    };
  }

  /**
   * Every wallet of the platform, for Billing support; filter by wallet, member account (name or email),
   * entry type and time. Each row names the account it belongs to.
   */
  async ledger(filter: LedgerFilter, query: PaginateQuery) {
    const page = await paginate(query, this.prisma.coinTransaction, {
      where: {
        ...(filter.walletId ? { walletId: filter.walletId } : {}),
        ...(filter.account ? { wallet: { user: accountMatching(filter.account) } } : {}),
        ...this.between(filter.from, filter.to),
        ...(filter.kind === 'ALL' ? {} : { [counter(filter.kind)]: { ne: 0 } }),
        ...(filter.entryType ? { entryType: filter.entryType } : {}),
      },
      // `paginate` has no `include` key: `relations` alone becomes the Prisma include.
      relations: { wallet: { select: { userId: true, user: { select: ACCOUNT_SELECT } } } },
      sortableColumns: ['createdAt', 'entryType'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { entryType: ['$eq', '$in'], walletId: ['$eq'] },
    });
    return {
      ...page,
      data: (page.data as LedgerRow[]).map((entry) => ({
        ...lineOf(entry),
        walletId: entry.walletId,
        userId: entry.wallet.userId,
        account: entry.wallet.user,
        // Rows sharing one paymentId are one payment: an Admin refund pays all of them back at once.
        paymentId: entry.paymentId,
        reversesId: entry.reversesId,
      })),
    };
  }

  private whereOf(walletId: string, filter: StatementFilter): Prisma.CoinTransactionWhereInput {
    return {
      walletId,
      ...this.between(filter.from, filter.to),
      ...(filter.kind === 'ALL' ? {} : { [counter(filter.kind)]: { ne: 0 } }),
      ...(filter.entryType ? { entryType: filter.entryType } : {}),
    };
  }

  private between(from?: Date, to?: Date): Prisma.CoinTransactionWhereInput {
    return from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
  }
}

const counter = (kind: Exclude<StatementKind, 'ALL'>): 'mainAmount' | 'bonusAmount' =>
  kind === 'MAIN' ? 'mainAmount' : 'bonusAmount';
