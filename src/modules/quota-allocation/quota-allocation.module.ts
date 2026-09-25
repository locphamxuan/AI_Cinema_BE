import { Module } from '@nestjs/common';
import { QuotaAllocationController } from './quota-allocation.controller';
import { QuotaAllocationService } from './quota-allocation.service';
import { QuotaRequestController } from './quota-request.controller';
import { QuotaRequestService } from './quota-request.service';

@Module({
  controllers: [QuotaAllocationController, QuotaRequestController],
  providers: [QuotaAllocationService, QuotaRequestService],
})
export class QuotaAllocationModule {}
