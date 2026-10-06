import { Controller, Get, Post, Body, Patch, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CreateMembershipPlanRequestDto } from 'src/modules/episode-access/membership-plan/dto/create-membership-plan.request.dto';
import { SetPlanPriceRequestDto } from 'src/modules/episode-access/membership-plan/dto/membership-plan.request.dto';
import { PlanView } from 'src/modules/episode-access/membership-plan/dto/plan-view.dto';
import { UpdateMembershipPlanRequestDto } from 'src/modules/episode-access/membership-plan/dto/update-membership-plan.request.dto';
import { MembershipPlanService } from 'src/modules/episode-access/membership-plan/membership-plan.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-membership-plans')
@ApiBearerAuth()
@Controller('admin/membership-plans')
export class MembershipPlanAdminController {
  constructor(private readonly plans: MembershipPlanService) {}

  @Get()
  @RequirePermission(PERMISSION.BILLING_PLAN_MANAGE)
  @ApiOperation({ summary: 'Every plan, hidden ones included' })
  @ApiOkResponse({ type: PlanView, isArray: true })
  listAll() {
    return this.plans.listAll();
  }

  @Post()
  @RequirePermission(PERMISSION.BILLING_PLAN_MANAGE)
  @ApiOperation({ summary: 'Create a plan; the price is set separately' })
  create(@CurrentUser('id') actorId: string, @Body() dto: CreateMembershipPlanRequestDto) {
    return this.plans.create(dto, actorId);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION.BILLING_PLAN_MANAGE)
  @ApiOperation({ summary: 'Edit a plan, show it or hide it' })
  update(@Param('id', ID) id: string, @CurrentUser('id') actorId: string, @Body() dto: UpdateMembershipPlanRequestDto) {
    return this.plans.update(id, dto, actorId);
  }

  @Post(':id/prices')
  @RequirePermission(PERMISSION.BILLING_PRICE_MANAGE)
  @ApiOperation({ summary: 'Close the price in force and open a new one' })
  setPrice(@Param('id', ID) id: string, @CurrentUser('id') actorId: string, @Body() dto: SetPlanPriceRequestDto) {
    return this.plans.setPrice(id, dto.priceCoins, dto.effectiveFrom ?? new Date(), actorId);
  }
}
