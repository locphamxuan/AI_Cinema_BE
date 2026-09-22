import { Module } from '@nestjs/common';
import { QuotaAllocationController } from './quota-allocation.controller';
import { QuotaAllocationService } from './quota-allocation.service';

@Module({
  controllers: [QuotaAllocationController],
  providers: [QuotaAllocationService],
})
export class QuotaAllocationModule {}
