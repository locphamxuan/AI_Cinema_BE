import { Module } from '@nestjs/common';
import { QueueModule } from 'src/infrastructure/queue/queue.module';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { MembershipPlanModule } from '../membership-plan/membership-plan.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionRenewalService } from './subscription-renewal.service';
import { SubscriptionRenewalSweep } from './subscription-renewal.sweep';
import { SubscriptionService } from './subscription.service';
import { AdminSubscriptionController } from 'src/modules/episode-access/subscription/admin-subscription.controller';
import { PlanDaysGrantService } from './plan-days-grant.service';

/**
 * Steps 9, 10 and 19: joining a plan, stopping auto-renew and letting the sweeper renew it; plus
 * the plan days a reward spin gives (BR-09).
 */
@Module({
  imports: [
    CoinWalletModule,
    MembershipPlanModule,
    PlatformSettingModule,
    NotificationModule,
    AuditLogModule,
    QueueModule,
  ],
  controllers: [SubscriptionController, AdminSubscriptionController],
  providers: [SubscriptionService, SubscriptionRenewalService, SubscriptionRenewalSweep, PlanDaysGrantService],
  exports: [SubscriptionService, PlanDaysGrantService],
})
export class SubscriptionModule {}
