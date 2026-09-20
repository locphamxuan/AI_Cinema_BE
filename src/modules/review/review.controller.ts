import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateEpisodeSubmissionRequestDto } from './dto/create-episode-submission.request.dto';
import { CreateReviewRequestDto, DecideReviewRequestDto } from './dto/create-review.request.dto';
import { ReviewService } from './review.service';

@ApiTags('reviews')
@Controller()
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post('episode-packages/:packageId/submissions')
  async submit(@Param('packageId') packageId: string, @Body() dto: CreateEpisodeSubmissionRequestDto) {
    return this.reviewService.createEpisodeSubmission(packageId, dto);
  }

  @Post('episode-packages/:packageId/reviews')
  async createReview(@Param('packageId') packageId: string, @Body() dto: CreateReviewRequestDto) {
    return this.reviewService.createReview(packageId, dto);
  }

  @Get('reviews/:reviewId')
  async findById(@Param('reviewId') reviewId: string) {
    return this.reviewService.findById(reviewId);
  }

  @Patch('reviews/:reviewId')
  async decide(@Param('reviewId') reviewId: string, @Body() dto: DecideReviewRequestDto) {
    return this.reviewService.decide(reviewId, dto);
  }
}
