import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { EpisodePurchaseController } from './episode-purchase.controller';
import { EpisodePurchaseService } from './episode-purchase.service';

/** Step 17: unlock one episode with Coins. */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule, AuditLogModule],
  controllers: [EpisodePurchaseController],
  providers: [EpisodePurchaseService],
  exports: [EpisodePurchaseService],
})
export class EpisodePurchaseModule {}
