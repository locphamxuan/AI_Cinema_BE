import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateQuotaRequestRequestDto } from './dto/create-quota-request.request.dto';
import { ApproveQuotaRequestRequestDto, RejectQuotaRequestRequestDto } from './dto/decide-quota-request.request.dto';
import { QuotaRequestService } from './quota-request.service';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('quota-requests')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class QuotaRequestController {
  constructor(private readonly quotaRequestService: QuotaRequestService) {}

  @Post('production-plans/:planId/quota-requests')
  @Audit.quotaRequested()
  @RequirePermission(PERMISSION.QUOTA_REQUEST)
  async create(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: CreateQuotaRequestRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaRequestService.create(planId, dto, userId);
  }

  @Get('production-plans/:planId/quota-requests')
  async findAll(@Param('planId', ParseUUIDPipe) planId: string) {
    return this.quotaRequestService.findAll(planId);
  }

  @Post('quota-requests/:quotaRequestId/approve')
  @Audit.quotaApproved()
  @RequirePermission(PERMISSION.QUOTA_MANAGE)
  async approve(
    @Param('quotaRequestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveQuotaRequestRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaRequestService.approve(requestId, dto, userId);
  }

  @Post('quota-requests/:quotaRequestId/reject')
  @Audit.quotaRejected()
  @RequirePermission(PERMISSION.QUOTA_MANAGE)
  async reject(
    @Param('quotaRequestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectQuotaRequestRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaRequestService.reject(requestId, dto, userId);
  }
}
