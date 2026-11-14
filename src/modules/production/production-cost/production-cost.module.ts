import { Module } from '@nestjs/common';
import { ProductionCostController } from './production-cost.controller';
import { ProductionCostService } from './production-cost.service';

@Module({
  controllers: [ProductionCostController],
  providers: [ProductionCostService],
  exports: [ProductionCostService],
})
export class ProductionCostModule {}
