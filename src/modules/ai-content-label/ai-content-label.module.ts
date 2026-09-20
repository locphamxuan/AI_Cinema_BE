import { Module } from '@nestjs/common';
import { AiContentLabelController } from './ai-content-label.controller';
import { AiContentLabelService } from './ai-content-label.service';

@Module({
  controllers: [AiContentLabelController],
  providers: [AiContentLabelService],
})
export class AiContentLabelModule {}