import { Injectable, NotFoundException } from '@nestjs/common';
import { CoinEntryType, type CoinTransaction, type Prisma } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet.service';

/** Which counter a statement line is about; ALL shows main and bonus together. */
export type StatementKind = 'MAIN' | 'BONUS' | 'ALL';

export interface StatementFilter {
  userId: string;
  kind: StatementKind;
  entryType?: CoinEntryType;
  from?: Date;
  to?: Date;
}

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
    return { ...lineOf(entry), walletId: wallet.id, reversesId: entry.reversesId, lotId: entry.lotId };
  }

  /** Every wallet of the platform, for Billing support; filter by wallet, entry type and time. */
  async ledger(filter: Omit<StatementFilter, 'userId'> & { walletId?: string }, query: PaginateQuery) {
    const page = await paginate(query, this.prisma.coinTransaction, {
      where: {
        ...(filter.walletId ? { walletId: filter.walletId } : {}),
        ...this.between(filter.from, filter.to),
        ...(filter.kind === 'ALL' ? {} : { [counter(filter.kind)]: { ne: 0 } }),
        ...(filter.entryType ? { entryType: filter.entryType } : {}),
      },
      // `paginate` has no `include` key: `relations` alone becomes the Prisma include.
      relations: { wallet: { select: { userId: true } } },
      sortableColumns: ['createdAt', 'entryType'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { entryType: ['$eq', '$in'], walletId: ['$eq'] },
    });
    return {
      ...page,
      data: (page.data as (CoinTransaction & { wallet: { userId: string } })[]).map((entry) => ({
        ...lineOf(entry),
        walletId: entry.walletId,
        userId: entry.wallet.userId,
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
