import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AiLabelService } from './ai-label.service';
import { ComplianceService } from './compliance.service';
import { ContentReviewService } from './content-review.service';
import {
  ApplyAiLabelRequestDto,
  ReviewMediaRequestDto,
  RunComplianceRequestDto,
} from './dto/content-review.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('content-review')
@ApiBearerAuth()
@Controller('media-assets/:mediaAssetId')
export class ContentReviewController {
  constructor(
    private readonly reviews: ContentReviewService,
    private readonly labels: AiLabelService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('review-sheet')
  @ApiOperation({ summary: 'AI Disclosure, length check, review history, AI label and compliance of a version' })
  sheet(@Param('mediaAssetId', ID) mediaAssetId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reviews.sheet(mediaAssetId, user);
  }

  @Post('reviews')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTENT_REVIEW)
  @ApiOperation({ summary: 'Approve the version, or request changes with feedback for the studio (steps 8–9)' })
  review(
    @Param('mediaAssetId', ID) mediaAssetId: string,
    @Body() dto: ReviewMediaRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.review(mediaAssetId, dto, user);
  }

  @Post('ai-content-labels')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTENT_REVIEW)
  @ApiOperation({ summary: 'Set the final AI label of the approved version (step 10, BR-40)' })
  label(
    @Param('mediaAssetId', ID) mediaAssetId: string,
    @Body() dto: ApplyAiLabelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labels.apply(mediaAssetId, dto, user);
  }

  @Post('compliance-checks')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTENT_REVIEW)
  @ApiOperation({ summary: 'Run the four compliance items; a failure sends the version back (step 11, BR-42)' })
  runCompliance(
    @Param('mediaAssetId', ID) mediaAssetId: string,
    @Body() dto: RunComplianceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.compliance.run(mediaAssetId, dto, user);
  }
}
