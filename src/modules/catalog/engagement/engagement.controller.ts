import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { OptionalUser } from 'src/common/decorators/optional-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { EngagementService } from './engagement.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('catalog')
@Controller()
export class EngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('movies/:movieId/engagement')
  @Public()
  @ApiOperation({ summary: 'Hearts and plays of a movie; likedByMe when the caller is signed in' })
  summary(@Param('movieId', ID) movieId: string, @OptionalUser() user?: AuthenticatedUser) {
    return this.engagement.summary(movieId, user?.id);
  }

  @Post('movies/:movieId/like')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Give the movie a heart' })
  like(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.engagement.like(movieId, user.id);
  }

  @Delete('movies/:movieId/like')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Take the heart back' })
  unlike(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.engagement.unlike(movieId, user.id);
  }

  @Post('episodes/:episodeId/views')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Count a play that started (once per signed-in viewer and episode every 30 minutes)' })
  view(@Param('episodeId', ID) episodeId: string, @OptionalUser() user?: AuthenticatedUser) {
    return this.engagement.recordView(episodeId, user?.id);
  }
}
