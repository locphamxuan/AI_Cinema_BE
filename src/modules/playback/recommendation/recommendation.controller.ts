import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { RecommendationService } from './recommendation.service';
import { RecommendationResponseDto } from './recommendation-response.dto';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendations: RecommendationService) {}

  @Get('for-you')
  @ApiOperation({ summary: 'Personalized recommendations; T18 filtered by the age gate (BR-68)' })
  @ApiOkResponse({ type: [RecommendationResponseDto] })
  forYou(@CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.forYou(user.id);
  }

  @Get('trending')
  @Public()
  @ApiOperation({ summary: 'Trending AI sample films from the R2 catalog, age-gated for cold starts (Guest)' })
  @ApiOkResponse({ type: [RecommendationResponseDto] })
  trending() {
    return this.recommendations.trending();
  }

  @Get('similar/:movieId')
  @Public()
  @ApiOperation({ summary: 'Movies similar to one movie (genres, country, popularity); T18 only for adults (BR-68)' })
  @ApiOkResponse({ type: [RecommendationResponseDto] })
  similar(@Param('movieId', ParseUUIDPipe) movieId: string, @Req() req: { user?: AuthenticatedUser }) {
    // Public: a Guest has no user, a signed-in Member's age opens T18 titles.
    return this.recommendations.similar(movieId, req.user?.id);
  }

  @Get('after/:movieId')
  @ApiOperation({
    summary:
      'AI suggestions under the player once a movie ends: close to it and to the member viewing behavior (BR-68)',
  })
  @ApiOkResponse({ type: [RecommendationResponseDto] })
  after(@Param('movieId', ParseUUIDPipe) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recommendations.after(movieId, user.id);
  }
}
