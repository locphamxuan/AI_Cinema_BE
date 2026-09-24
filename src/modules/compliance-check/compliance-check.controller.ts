import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';
import { ComplianceCheckService } from './compliance-check.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('compliance-checks')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class ComplianceCheckController {
  constructor(private readonly complianceCheckService: ComplianceCheckService) {}

  @Post('episode-packages/:packageId/compliance-checks')
  @Roles(...REVIEWER_ROLES)
  async create(@Param('packageId') packageId: string, @Body() dto: CreateComplianceCheckRequestDto) {
    return this.complianceCheckService.create(packageId, dto);
  }

  @Get('episode-packages/:packageId/compliance-checks')
  async findAll(@Param('packageId') packageId: string) {
    return this.complianceCheckService.findAll(packageId);
  }

  @Patch('compliance-checks/:checkId')
  @Roles(...REVIEWER_ROLES)
  async decide(@Param('checkId') checkId: string, @Body() dto: DecideComplianceCheckRequestDto) {
    return this.complianceCheckService.decide(checkId, dto);
  }
}
