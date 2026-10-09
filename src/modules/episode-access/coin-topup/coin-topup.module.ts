import { Module } from '@nestjs/common';
import { QueueModule } from 'src/infrastructure/queue/queue.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { CoinTopUpController } from './coin-topup.controller';
import { CoinTopUpService } from './coin-topup.service';
import { PaymentGatewayService } from './gateways/payment-gateway.service';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentReconcileSweep } from './payment-reconcile.sweep';
import { TopUpExpirySweep } from './top-up-expiry.sweep';
import { TopUpLookupService } from './topup-lookup.service';
import { TopUpSettlementService } from './topup-settlement.service';

/**
 * Step 12: buying Coins with a gateway. The order, the ledger entry and the expiry sweep live
 * here; `PaymentGatewayService` speaks the gateways' dialects (signed URLs, checksum checks,
 * status queries) so `settle` stays the single entry point that credits the wallet.
 */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule, NotificationModule, QueueModule],
  controllers: [CoinTopUpController, PaymentCallbackController],
  providers: [
    CoinTopUpService,
    PaymentGatewayService,
    TopUpLookupService,
    TopUpSettlementService,
    TopUpExpirySweep,
    PaymentReconcileSweep,
  ],
  exports: [CoinTopUpService],
})
export class CoinTopUpModule {}
