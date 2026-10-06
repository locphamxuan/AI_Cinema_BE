import { Module } from '@nestjs/common';
import { QueueModule } from 'src/infrastructure/queue/queue.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { CoinTopUpController } from './coin-topup.controller';
import { CoinTopUpService } from './coin-topup.service';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentReconcileSweep } from './payment-reconcile.sweep';
import { TopUpExpirySweep } from './top-up-expiry.sweep';

/**
 * Step 12: buying Coins with a gateway. The order, the ledger entry and the expiry sweep live
 * here; the gateway SDK and the webhook signature check are outside MF-2, so `settle` is the entry
 * point an adapter would call.
 */
@Module({
  imports: [CoinWalletModule, PlatformSettingModule, NotificationModule, QueueModule],
  controllers: [CoinTopUpController, PaymentCallbackController],
  providers: [CoinTopUpService, TopUpExpirySweep, PaymentReconcileSweep],
  exports: [CoinTopUpService],
})
export class CoinTopUpModule {}
