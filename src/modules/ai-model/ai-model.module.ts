import { Module } from '@nestjs/common';
import { AiModelRouterService } from './ai-model-router.service';

@Module({
  providers: [AiModelRouterService],
  exports: [AiModelRouterService],
})
export class AiModelModule {}
