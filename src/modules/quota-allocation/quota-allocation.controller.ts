import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateQuotaAllocationRequestDto } from './dto/create-quota-allocation.request.dto';
import { QuotaAllocationService } from './quota-allocation.service';

@ApiTags('quota-allocations')
@ApiBearerAuth()
@Controller()
export class QuotaAllocationController {
  constructor(private readonly quotaAllocationService: QuotaAllocationService) {}

  @Post('production-plans/:planId/quota-allocations')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
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
