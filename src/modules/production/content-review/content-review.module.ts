import { Module } from '@nestjs/common';
import { AiLabelService } from './ai-label.service';
import { ComplianceService } from './compliance.service';
import { ContentReviewController } from './content-review.controller';
import { ContentReviewService } from './content-review.service';

@Module({
  controllers: [ContentReviewController],
  providers: [ContentReviewService, AiLabelService, ComplianceService],
  exports: [ContentReviewService],
})
export class ContentReviewModule {}
