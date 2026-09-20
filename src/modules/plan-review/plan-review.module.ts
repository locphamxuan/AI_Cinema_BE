import { Module } from '@nestjs/common';
import { PlanReviewController } from './plan-review.controller';
import { PlanReviewService } from './plan-review.service';

@Module({
  controllers: [PlanReviewController],
  providers: [PlanReviewService],
})
export class PlanReviewModule {}
