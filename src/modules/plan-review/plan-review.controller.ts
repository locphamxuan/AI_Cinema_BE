import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreatePlanReviewRequestDto } from './dto/create-plan-review.request.dto';
import { DecidePlanReviewRequestDto } from './dto/decide-plan-review.request.dto';
import { PlanReviewService } from './plan-review.service';

@ApiTags('plan-reviews')
@ApiBearerAuth()
@Controller()
export class PlanReviewController {
  constructor(private readonly planReviewService: PlanReviewService) {}

  @Post('production-plans/:planId/plan-reviews')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
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
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
  async decide(@Param('planReviewId') planReviewId: string, @Body() dto: DecidePlanReviewRequestDto) {
    return this.planReviewService.decide(planReviewId, dto);
  }
}
