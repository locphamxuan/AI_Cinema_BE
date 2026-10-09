import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { EntitlementController } from './entitlement.controller';
import { EntitlementService } from './entitlement.service';

/** The member library and the refund that follows a take-down. */
@Module({
  imports: [CoinWalletModule, NotificationModule, AuditLogModule],
  controllers: [EntitlementController],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
