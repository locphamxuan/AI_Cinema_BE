import { Module } from '@nestjs/common';
import { QueueModule } from 'src/infrastructure/queue/queue.module';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { MembershipPlanModule } from '../membership-plan/membership-plan.module';
import { AdminSubscriptionController, SubscriptionController } from './subscription.controller';
import { SubscriptionRenewalService } from './subscription-renewal.service';
import { SubscriptionRenewalSweep } from './subscription-renewal.sweep';
import { SubscriptionService } from './subscription.service';

/** Steps 9, 10 and 19: joining a plan, stopping auto-renew and letting the sweeper renew it. */
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
  providers: [SubscriptionService, SubscriptionRenewalService, SubscriptionRenewalSweep],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
