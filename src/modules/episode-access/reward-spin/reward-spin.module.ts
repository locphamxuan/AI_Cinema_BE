import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { RewardPrizeAdminController } from './reward-prize-admin.controller';
import { RewardPrizeAdminService } from './reward-prize-admin.service';
import { RewardSpinController } from './reward-spin.controller';
import { RewardSpinService } from './reward-spin.service';

/** BR-09: the reward wheel a milestone check-in unlocks, and the Admin's prize list. */
@Module({
  imports: [CoinWalletModule, SubscriptionModule, NotificationModule, AuditLogModule],
  controllers: [RewardSpinController, RewardPrizeAdminController],
  providers: [RewardSpinService, RewardPrizeAdminService],
})
export class RewardSpinModule {}
