import { Module } from '@nestjs/common';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AccessDecisionController } from './access-decision.controller';
import { AccessDecisionService } from './access-decision.service';
import { FriendshipController } from './friendship.controller';
import { FriendshipService } from './friendship.service';
import { WatchEntitlementService } from './watch-entitlement.service';

/** The one endpoint that answers whether an episode may be watched, plus friendships. */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule],
  controllers: [AccessDecisionController, FriendshipController],
  providers: [AccessDecisionService, FriendshipService, WatchEntitlementService],
  exports: [AccessDecisionService, FriendshipService, WatchEntitlementService],
})
export class AccessDecisionModule {}