import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PaginateQuery } from '@nestarc/pagination';
import { CoinAdjustService } from 'src/modules/episode-access/coin-wallet/coin-adjust.service';
import { CoinStatementQueryDto } from 'src/modules/episode-access/coin-wallet/statement/dto/coin-statement-query.dto';
import { WalletAdjustmentRequestDto } from 'src/modules/episode-access/coin-wallet/statement/dto/wallet-adjustment.request.dto';
import { StatementService } from 'src/modules/episode-access/coin-wallet/statement/statement.service';
import { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';

@Injectable()
export class AdminWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    private readonly coins: CoinAdjustService,
    private readonly statements: StatementService,
    private readonly auditLog: AuditLogService,
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
        from: filter.from ? new Date(filter.from) : undefined,
        to: filter.to ? new Date(filter.to) : undefined,
      },
      query,
    );
  }

  async adjust(dto: WalletAdjustmentRequestDto, admin: AuthenticatedUser) {
    const wallet = await this.wallets.walletOf(dto.userId);

    const movement = await this.prisma.$transaction(async (tx) => {
      const applied = await this.coins.apply(tx, wallet.id, {
        mainAmount: dto.mainAmount,
        bonusAmount: dto.bonusAmount,
        reason: dto.reason,
        createdById: admin.id,
      });

      await this.auditLog.record(
        {
          action: CONTENT_EVENT.COIN_ADJUSTED,
          entityType: 'CoinWallet',
          entityId: wallet.id,
          movieId: null,
          actorId: admin.id,
          payload: {
            userId: dto.userId,
            mainAmount: dto.mainAmount ?? 0,
            bonusAmount: dto.bonusAmount ?? 0,
            reason: dto.reason.trim(),
            transactionId: applied.transactionId,
          },
        },
        tx,
      );

      return applied;
    });

    return {
      userId: dto.userId,
      transactionId: movement.transactionId,
      mainAmount: dto.mainAmount ?? 0,
      bonusAmount: dto.bonusAmount ?? 0,
      mainBalance: movement.mainBalance,
      bonusBalance: movement.bonusBalance,
      reason: dto.reason.trim(),
    };
  }
}
