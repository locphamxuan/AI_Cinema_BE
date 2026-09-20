import { Module } from '@nestjs/common';
import { SceneModule } from 'src/modules/scene/scene.module';
import { ProductionProjectModule } from 'src/modules/production-project/production-project.module';
import { ProductionPlanController } from './production-plan.controller';
import { ProductionPlanService } from './production-plan.service';

@Module({
  imports: [ProductionProjectModule, SceneModule],
  controllers: [ProductionPlanController],
  providers: [ProductionPlanService],
  exports: [ProductionPlanService],
})
export class ProductionPlanModule {}
