import { Module } from '@nestjs/common';
import { ProductionProjectController } from './production-project.controller';
import { ProductionProjectService } from './production-project.service';

@Module({
  controllers: [ProductionProjectController],
  providers: [ProductionProjectService],
  exports: [ProductionProjectService],
})
export class ProductionProjectModule {}
