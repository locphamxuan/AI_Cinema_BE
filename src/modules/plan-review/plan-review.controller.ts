import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreatePlanReviewRequestDto } from './dto/create-plan-review.request.dto';
import { DecidePlanReviewRequestDto } from './dto/decide-plan-review.request.dto';
import { PlanReviewService } from './plan-review.service';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('plan-reviews')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class PlanReviewController {
  constructor(private readonly planReviewService: PlanReviewService) {}

  @Post('production-plans/:planId/plan-reviews')
  @RequirePermission(PERMISSION.PLAN_REVIEW)
  async create(
    @Param('planId') planId: string,
    @Body() dto: CreatePlanReviewRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.planReviewService.create(planId, dto, userId);
  }

  @Get('plan-reviews/:planReviewId')
  async findById(@Param('planReviewId') planReviewId: string) {
    return this.planReviewService.findById(planReviewId);
  }

  @Patch('plan-reviews/:planReviewId')
  @Audit.planReviewDecided()
  @RequirePermission(PERMISSION.PLAN_REVIEW)
  async decide(@Param('planReviewId') planReviewId: string, @Body() dto: DecidePlanReviewRequestDto) {
    return this.planReviewService.decide(planReviewId, dto);
  }
}
