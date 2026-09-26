import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateQuotaAllocationRequestDto } from './dto/create-quota-allocation.request.dto';
import { QuotaAllocationService } from './quota-allocation.service';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('quota-allocations')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class QuotaAllocationController {
  constructor(private readonly quotaAllocationService: QuotaAllocationService) {}

  @Post('production-plans/:planId/quota-allocations')
  @Audit.quotaAllocated()
  @RequirePermission(PERMISSION.QUOTA_MANAGE)
  async create(
    @Param('planId') planId: string,
    @Body() dto: CreateQuotaAllocationRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaAllocationService.create(planId, dto, userId);
  }

  @Get('production-plans/:planId/quota-allocations')
  async findAll(@Param('planId') planId: string) {
    return this.quotaAllocationService.findAll(planId);
  }
}
