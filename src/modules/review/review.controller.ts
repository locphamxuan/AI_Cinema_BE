import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateEpisodeSubmissionRequestDto } from './dto/create-episode-submission.request.dto';
import { CreateReviewRequestDto } from './dto/create-review.request.dto';
import { ReviewService } from './review.service';
import { DecideReviewRequestDto } from 'src/modules/review/dto/decide-review.request.dto';
import { Audit } from 'src/modules/audit-log/production-events';

@ApiTags('reviews')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('episode-packages/:packageId/submissions')
  @Audit.episodeSubmitted()
  @RequirePermission(PERMISSION.EPISODE_SUBMIT)
  async submit(
    @Param('packageId') packageId: string,
    @Body() dto: CreateEpisodeSubmissionRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reviewService.createEpisodeSubmission(packageId, dto, userId);
  }

  @Post('episode-packages/:packageId/reviews')
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
  async createReview(
    @Param('packageId') packageId: string,
    @Body() dto: CreateReviewRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reviewService.createReview(packageId, dto, userId);
  }

  @Get('reviews/:reviewId')
  async findById(@Param('reviewId') reviewId: string) {
    return this.reviewService.findById(reviewId);
  }

  @Patch('reviews/:reviewId')
  @Audit.contentReviewed()
  @RequirePermission(PERMISSION.EPISODE_REVIEW)
  async decide(@Param('reviewId') reviewId: string, @Body() dto: DecideReviewRequestDto) {
    return this.reviewService.decide(reviewId, dto);
  }
}
