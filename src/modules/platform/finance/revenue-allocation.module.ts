import { Module } from '@nestjs/common';
import { RevenueAllocationService } from './revenue-allocation.service';

/** The BR-48 share of Monthly-plan revenue, used by the finance screens and by a refund of a plan payment. */
@Module({
  providers: [RevenueAllocationService],
  exports: [RevenueAllocationService],
})
export class RevenueAllocationModule {}
