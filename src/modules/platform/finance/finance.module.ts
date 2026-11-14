import { Module } from '@nestjs/common';
import { FilmFinanceService } from './film-finance.service';
import { FinanceController } from './finance.controller';
import { FinanceJobs } from './finance.jobs';
import { RevenueAllocationService } from './revenue-allocation.service';
import { RiskFlagService } from './risk-flag.service';

/** MF-5, Admin only: profit / ROI per movie, BR-48 revenue sharing by watch time, risky Coin transactions. */
@Module({
  controllers: [FinanceController],
  providers: [FilmFinanceService, RevenueAllocationService, RiskFlagService, FinanceJobs],
})
export class FinanceModule {}
