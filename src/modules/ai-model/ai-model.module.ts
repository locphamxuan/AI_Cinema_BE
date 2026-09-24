import { Module } from '@nestjs/common';
import { AiModelController } from './ai-model.controller';
import { AiModelRouterService } from './ai-model-router.service';

@Module({
  controllers: [AiModelController],
  providers: [AiModelRouterService],
  exports: [AiModelRouterService],
})
export class AiModelModule {}
