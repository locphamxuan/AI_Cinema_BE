import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { AccessDecisionController } from './access-decision.controller';
import { AccessDecisionService } from './access-decision.service';

/** The one endpoint that answers whether an episode may be watched, and what else is possible. */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule],
  controllers: [AccessDecisionController],
  providers: [AccessDecisionService],
  exports: [AccessDecisionService],
})
export class AccessDecisionModule {}
