import { Module } from '@nestjs/common';
import { AccessDecisionModule } from './access-decision/access-decision.module';
import { CoinTopUpModule } from './coin-topup/coin-topup.module';
import { CoinWalletModule } from './coin-wallet/coin-wallet.module';
import { DailyRewardModule } from './daily-reward/daily-reward.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { EpisodePurchaseModule } from './episode-purchase/episode-purchase.module';
import { MembershipPlanModule } from './membership-plan/membership-plan.module';
import { RewardSpinModule } from './reward-spin/reward-spin.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { BillingReportModule } from 'src/modules/episode-access/billing-reports/billing-report.module';

/**
 * Main Flow 2 in one place: the Coin wallet, the access decision, buying an episode,
 * topping Coins up, the daily check-in and its reward wheel, the monthly plans and the reports Billing reads.
 * Publishing calls EntitlementService when content is taken down for good.
 */
@Module({
  imports: [
    CoinWalletModule,
    AccessDecisionModule,
    EpisodePurchaseModule,
    EntitlementModule,
    CoinTopUpModule,
    DailyRewardModule,
    RewardSpinModule,
    MembershipPlanModule,
    SubscriptionModule,
    BillingReportModule,
  ],
  exports: [EntitlementModule, CoinWalletModule, SubscriptionModule],
})
export class EpisodeAccessModule {}
