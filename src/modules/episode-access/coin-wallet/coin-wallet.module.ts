import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { RevenueAllocationModule } from 'src/modules/platform/finance/revenue-allocation.module';
import { CoinRefundController } from './coin-refund.controller';
import { CoinRefundService } from './coin-refund.service';
import { CoinSpendService } from './coin-spend.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './statement/admin-wallet.controller';
import { StatementController } from './statement/statement.controller';
import { StatementService } from './statement/statement.service';
import { WalletService } from './wallet.service';
import { AdminWalletService } from './statement/admin-wallet.service';

/**
 * The Coin purse every purchase of MF-2 goes through: the wallet screen, the statement, the Admin's
 * ledger and the refund of a whole Coin payment. The Admin never edits a balance by hand.
 */
@Module({
  imports: [PlatformSettingModule, NotificationModule, AuditLogModule, RevenueAllocationModule],
  controllers: [WalletController, CoinRefundController, StatementController, AdminWalletController],
  providers: [WalletService, CoinSpendService, CoinRefundService, StatementService, AdminWalletService],
  exports: [WalletService, CoinSpendService, CoinRefundService, StatementService],
})
export class CoinWalletModule {}
