import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginateQuery } from '@nestarc/pagination';
import { CoinStatementQueryDto } from 'src/modules/episode-access/coin-wallet/statement/dto/coin-statement-query.dto';
import { StatementService } from 'src/modules/episode-access/coin-wallet/statement/statement.service';
import { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';

/** The Admin reads wallets and the Coin ledger; a balance only changes through a payment, a reward or a refund. */
@Injectable()
export class AdminWalletService {
  constructor(
    private readonly wallets: WalletService,
    private readonly statements: StatementService,
  ) {}

  async wallet(userId: string) {
    const wallet = await this.wallets.adminView(userId);

    if (!wallet) {
      throw new NotFoundException({
        message: 'Wallet not found',
        details: {
          reason: 'WALLET_NOT_FOUND',
        },
      });
    }

    return wallet;
  }

  ledger(filter: CoinStatementQueryDto, query: PaginateQuery) {
    return this.statements.ledger(
      {
        kind: filter.kind ?? 'ALL',
        entryType: filter.entryType,
        walletId: filter.walletId,
        account: filter.account,
        from: filter.from ? new Date(filter.from) : undefined,
        to: filter.to ? new Date(filter.to) : undefined,
      },
      query,
    );
  }
}
