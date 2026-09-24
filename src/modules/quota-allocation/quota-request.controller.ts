import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CREATOR_ROLES, MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';
import { CreateQuotaRequestRequestDto } from './dto/create-quota-request.request.dto';
import { ApproveQuotaRequestRequestDto, RejectQuotaRequestRequestDto } from './dto/decide-quota-request.request.dto';
import { QuotaRequestService } from './quota-request.service';

@ApiTags('quota-requests')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class QuotaRequestController {
  constructor(private readonly quotaRequestService: QuotaRequestService) {}

  @Post('production-plans/:planId/quota-requests')
  @Roles(...CREATOR_ROLES)
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
  @Roles(...REVIEWER_ROLES)
  async approve(
    @Param('quotaRequestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveQuotaRequestRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaRequestService.approve(requestId, dto, userId);
  }

  @Post('quota-requests/:quotaRequestId/reject')
  @Roles(...REVIEWER_ROLES)
  async reject(
    @Param('quotaRequestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectQuotaRequestRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.quotaRequestService.reject(requestId, dto, userId);
  }
}
