import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateComplianceCheckRequestDto } from './dto/create-compliance-check.request.dto';
import { DecideComplianceCheckRequestDto } from './dto/decide-compliance-check.request.dto';
import { RecordComplianceReviewRequestDto } from './dto/record-compliance-review.request.dto';
import { ComplianceCheckService } from './compliance-check.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('compliance-checks')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class ComplianceCheckController {
  constructor(private readonly complianceCheckService: ComplianceCheckService) {}

  @Post('episode-packages/:packageId/compliance-checks')
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
  async create(
    @Param('packageId') packageId: string,
    @Body() dto: CreateComplianceCheckRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.complianceCheckService.create(packageId, dto, userId);
  }

  @Post('episode-packages/:packageId/compliance-reviews')
  @Audit.complianceReviewed()
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
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
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
  async decide(
    @Param('checkId') checkId: string,
    @Body() dto: DecideComplianceCheckRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.complianceCheckService.decide(checkId, dto, userId);
  }
}
