import { Module } from '@nestjs/common';
import { ProductionProjectModule } from 'src/modules/production-project/production-project.module';
import { ProductionPlanController } from './production-plan.controller';
import { ProductionPlanService } from './production-plan.service';

@Module({
  imports: [ProductionProjectModule],
  controllers: [ProductionPlanController],
  providers: [ProductionPlanService],
})
export class ProductionPlanModule {}
