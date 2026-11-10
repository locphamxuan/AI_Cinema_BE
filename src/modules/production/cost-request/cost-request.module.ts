import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { CostRequestController } from './cost-request.controller';
import { CostRequestService } from './cost-request.service';

@Module({
  imports: [ProductionCostModule],
  controllers: [CostRequestController],
  providers: [CostRequestService],
})
export class CostRequestModule {}
