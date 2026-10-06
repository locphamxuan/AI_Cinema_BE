import { Body, Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { MembershipPlanService } from './membership-plan.service';
import { PlanView } from 'src/modules/episode-access/membership-plan/dto/plan-view.dto';

@ApiTags('membership-plans')
@Controller('membership-plans')
export class MembershipPlanController {
  constructor(private readonly plans: MembershipPlanService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'The plans on sale, with the price in force' })
  @ApiOkResponse({ type: PlanView, isArray: true })
  list() {
    return this.plans.listPublic();
  }
}
