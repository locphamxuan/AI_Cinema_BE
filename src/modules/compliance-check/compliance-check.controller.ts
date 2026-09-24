import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';
import { RecordComplianceReviewRequestDto } from './dto/record-compliance-review.request.dto';
import { ComplianceCheckService } from './compliance-check.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
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
  async create(
    @Param('packageId') packageId: string,
    @Body() dto: CreateComplianceCheckRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.complianceCheckService.create(packageId, dto, userId);
  }

  @Post('episode-packages/:packageId/compliance-reviews')
  @Roles(...REVIEWER_ROLES)
  async recordReview(
    @Param('packageId') packageId: string,
    @Body() dto: RecordComplianceReviewRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.complianceCheckService.recordReview(packageId, dto, userId);
  }

  @Get('episode-packages/:packageId/compliance-checks')
  async findAll(@Param('packageId') packageId: string) {
    return this.complianceCheckService.findAll(packageId);
  }

  @Patch('compliance-checks/:checkId')
  @Roles(...REVIEWER_ROLES)
  async decide(
    @Param('checkId') checkId: string,
    @Body() dto: DecideComplianceCheckRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.complianceCheckService.decide(checkId, dto, userId);
  }
}
