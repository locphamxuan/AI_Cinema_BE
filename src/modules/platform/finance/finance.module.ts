import { Module } from '@nestjs/common';
import { UserModule } from 'src/modules/identity/user/user.module';
import { FilmFinanceService } from './film-finance.service';
import { FinanceController } from './finance.controller';
import { FinanceJobs } from './finance.jobs';
import { RevenueAllocationService } from './revenue-allocation.service';
import { RiskFlagService } from './risk-flag.service';

/** MF-5, Admin only: profit / ROI per movie (with its BR-48 Monthly-plan share by watch time), risky Coin transactions. */
@Module({
  imports: [UserModule],
  controllers: [FinanceController],
  providers: [FilmFinanceService, RevenueAllocationService, RiskFlagService, FinanceJobs],
})
export class FinanceModule {}
