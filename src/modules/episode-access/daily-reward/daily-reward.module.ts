import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { CoinWalletModule } from '../coin-wallet/coin-wallet.module';
import { DailyRewardController } from './daily-reward.controller';
import { DailyRewardService } from './daily-reward.service';
import { RewardRuleAdminController } from './reward-rule-admin.controller';
import { RewardRuleAdminService } from 'src/modules/episode-access/daily-reward/reward-rule-admin.service';

/** Step 12: the daily check-in for members, and the streak ladder for the Admin. */
@Module({
  imports: [CoinWalletModule, AuditLogModule],
  controllers: [DailyRewardController, RewardRuleAdminController],
  providers: [DailyRewardService, RewardRuleAdminService],
  exports: [DailyRewardService],
})
export class DailyRewardModule {}
