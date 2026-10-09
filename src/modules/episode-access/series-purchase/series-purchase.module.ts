import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { SeriesPurchaseController } from './series-purchase.controller';
import { SeriesPurchaseService } from './series-purchase.service';

/** Step 17: unlock a whole series with Coins, at the movie's bundle price. */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule, AuditLogModule],
  controllers: [SeriesPurchaseController],
  providers: [SeriesPurchaseService],
})
export class SeriesPurchaseModule {}
