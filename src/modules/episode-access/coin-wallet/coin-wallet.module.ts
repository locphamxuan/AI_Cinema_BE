import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { BonusExpirySweep } from './bonus-expiry.sweep';
import { CoinAdjustService } from './coin-adjust.service';
import { CoinSpendService } from './coin-spend.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './statement/admin-wallet.controller';
import { StatementController } from './statement/statement.controller';
import { StatementService } from './statement/statement.service';
import { WalletService } from './wallet.service';
import { AdminWalletService } from './statement/admin-wallet.service';

/**
 * The Coin purse every purchase of MF-2 goes through: the wallet screen, the statement, the
 * manual corrections and the sweeper that expires bonus lots.
 */
@Module({
  imports: [PlatformSettingModule, NotificationModule, AuditLogModule],
  controllers: [WalletController, StatementController, AdminWalletController],
  providers: [
    WalletService,
    CoinSpendService,
    CoinAdjustService,
    StatementService,
    BonusExpirySweep,
    AdminWalletService,
  ],
  exports: [WalletService, CoinSpendService, CoinAdjustService, StatementService],
})
export class CoinWalletModule {}
