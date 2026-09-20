import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateQuotaAllocationRequestDto } from './dto/create-quota-allocation.request.dto';
import { QuotaAllocationService } from './quota-allocation.service';

@ApiTags('quota-allocations')
@Controller()
export class QuotaAllocationController {
  constructor(private readonly quotaAllocationService: QuotaAllocationService) {}

  @Post('production-plans/:planId/quota-allocations')
  async create(@Param('planId') planId: string, @Body() dto: CreateQuotaAllocationRequestDto) {
    return this.quotaAllocationService.create(planId, dto);
  }

  @Get('production-plans/:planId/quota-allocations')
  async findAll(@Param('planId') planId: string) {
    return this.quotaAllocationService.findAll(planId);
  }
}