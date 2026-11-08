import { Module } from '@nestjs/common';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { AiLabelService } from './ai-label.service';
import { ComplianceService } from './compliance.service';
import { ContentReviewController } from './content-review.controller';
import { ContentReviewService } from './content-review.service';

@Module({
  imports: [StudioModule],
  controllers: [ContentReviewController],
  providers: [ContentReviewService, AiLabelService, ComplianceService],
  exports: [ContentReviewService],
})
export class ContentReviewModule {}
