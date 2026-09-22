import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePlanReviewRequestDto } from './dto/create-plan-review.request.dto';
import { DecidePlanReviewRequestDto } from './dto/decide-plan-review.request.dto';
import { PlanReviewService } from './plan-review.service';

@ApiTags('plan-reviews')
@Controller()
export class PlanReviewController {
  constructor(private readonly planReviewService: PlanReviewService) {}

  @Post('production-plans/:planId/plan-reviews')
  async create(@Param('planId') planId: string, @Body() dto: CreatePlanReviewRequestDto) {
    return this.planReviewService.create(planId, dto);
  }

  @Get('plan-reviews/:planReviewId')
  async findById(@Param('planReviewId') planReviewId: string) {
    return this.planReviewService.findById(planReviewId);
  }

  @Patch('plan-reviews/:planReviewId')
  async decide(@Param('planReviewId') planReviewId: string, @Body() dto: DecidePlanReviewRequestDto) {
    return this.planReviewService.decide(planReviewId, dto);
  }
}
