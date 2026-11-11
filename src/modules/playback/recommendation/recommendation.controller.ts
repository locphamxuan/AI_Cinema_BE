import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
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
  @ApiOperation({ summary: 'Trending AI sample films from the R2 catalog, age-gated for cold starts' })
  @ApiOkResponse({ type: [RecommendationResponseDto] })
  trending() {
    return this.recommendations.trending();
  }
}
