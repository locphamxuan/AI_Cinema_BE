import { Module } from '@nestjs/common';
import { BillingReportController } from './billing-report.controller';
import { BillingReportService } from './billing-report.service';

/** Revenue and churn of the monthly plans, read from the subscription cycles. */
@Module({
  controllers: [BillingReportController],
  providers: [BillingReportService],
})
export class BillingReportModule {}
