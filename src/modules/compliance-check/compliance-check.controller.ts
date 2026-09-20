import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';
import { ComplianceCheckService } from './compliance-check.service';

@ApiTags('compliance-checks')
@Controller()
export class ComplianceCheckController {
  constructor(private readonly complianceCheckService: ComplianceCheckService) {}

  @Post('episode-packages/:packageId/compliance-checks')
  async create(@Param('packageId') packageId: string, @Body() dto: CreateComplianceCheckRequestDto) {
    return this.complianceCheckService.create(packageId, dto);
  }

  @Get('episode-packages/:packageId/compliance-checks')
  async findAll(@Param('packageId') packageId: string) {
    return this.complianceCheckService.findAll(packageId);
  }

  @Patch('compliance-checks/:checkId')
  async decide(@Param('checkId') checkId: string, @Body() dto: DecideComplianceCheckRequestDto) {
    return this.complianceCheckService.decide(checkId, dto);
  }
}