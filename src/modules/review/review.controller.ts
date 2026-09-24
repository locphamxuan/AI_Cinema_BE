import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateEpisodeSubmissionRequestDto } from './dto/create-episode-submission.request.dto';
import { CreateReviewRequestDto } from './dto/create-review.request.dto';
import { ReviewService } from './review.service';
import { DecideReviewRequestDto } from 'src/modules/review/dto/decide-review.request.dto';
import { CREATOR_ROLES, MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('reviews')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('episode-packages/:packageId/submissions')
  @Roles(...CREATOR_ROLES)
  async submit(
    @Param('packageId') packageId: string,
    @Body() dto: CreateEpisodeSubmissionRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reviewService.createEpisodeSubmission(packageId, dto, userId);
  }

  @Post('episode-packages/:packageId/reviews')
  @Roles(...REVIEWER_ROLES)
  async createReview(@Param('packageId') packageId: string, @Body() dto: CreateReviewRequestDto) {
    return this.reviewService.createReview(packageId, dto);
  }

  @Get('reviews/:reviewId')
  async findById(@Param('reviewId') reviewId: string) {
    return this.reviewService.findById(reviewId);
  }

  @Patch('reviews/:reviewId')
  @Roles(...REVIEWER_ROLES)
  async decide(@Param('reviewId') reviewId: string, @Body() dto: DecideReviewRequestDto) {
    return this.reviewService.decide(reviewId, dto);
  }
}
