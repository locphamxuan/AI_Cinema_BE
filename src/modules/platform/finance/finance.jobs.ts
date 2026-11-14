import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { previousPeriod } from './finance-period';
import { RevenueAllocationService } from './revenue-allocation.service';
import { RiskFlagService } from './risk-flag.service';

/**
 * BR-48: early each month the previous month's Monthly-plan revenue is shared once (the sweep repeats every few
 * hours and does nothing once the month has rows). The risk rules scan the Coin ledger every hour.
 */
@Injectable()
export class FinanceJobs implements OnModuleInit {
  constructor(
    private readonly queue: JobQueue,
    private readonly allocations: RevenueAllocationService,
    private readonly risk: RiskFlagService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.queue.every('finance.revenue-allocation', this.config.schedules.revenueAllocationSweepMs, () =>
      this.allocateLastMonth().then(() => undefined),
    );
    this.queue.every('finance.risk-scan', this.config.schedules.riskScanSweepMs, () =>
      this.risk.scan().then(() => undefined),
    );
  }

  allocateLastMonth(now = new Date()): Promise<boolean> {
    return this.allocations.allocateIfMissing(previousPeriod(now), now);
  }
}
