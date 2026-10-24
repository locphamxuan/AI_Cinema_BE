import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { OptionalUser } from 'src/common/decorators/optional-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { AdBreakService } from './ad-break.service';
import { AdBreakPlayedRequestDto } from 'src/modules/playback/ad-break/dto/ad-break-played.request.dto';
import { AdBreakPlayedViewDto } from 'src/modules/playback/ad-break/dto/ad-break-played.view.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Public like the session routes: ownership is checked against the session row. */
@ApiTags('playback')
@Public()
@Controller('playback')
export class AdBreakController {
  constructor(private readonly breaks: AdBreakService) {}

  @Post('sessions/:sessionId/ad-breaks/:breakId/played')
  @ApiOperation({
    summary: 'Player reached the cue: start the ad and count the impression (flow 3, step 17)',
    description:
      'An impression is only counted when positionSeconds is within 30s of the scheduled cue. A position before the cue is refused with AD_BREAK_NOT_REACHED; a forward seek past the cue is refused with AD_BREAK_MISSED and is not billed (product decision: a skipped cue earns no impression). Starting an ad does not set completedView — the player confirms completion separately.',
  })
  @ApiHeader({ name: 'X-Guest-Key', required: false, description: 'Must match the key the session was opened with' })
  @ApiOkResponse({ type: AdBreakPlayedViewDto })
  played(
    @Param('sessionId', ID) sessionId: string,
    @Param('breakId', ID) breakId: string,
    @Body() dto: AdBreakPlayedRequestDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Headers('x-guest-key') guestKey?: string,
  ) {
    return this.breaks.markPlayed(sessionId, breakId, { userId: user?.id, guestKey }, dto);
  }

  @Post('sessions/:sessionId/ad-breaks/:breakId/completed')
  @ApiOperation({
    summary: 'Player finished the ad: record a completed view (flow 3, step 17)',
    description:
      'Completion is only recorded after the break was started and at least the ad duration (minus a 2s tolerance) has elapsed on the server clock. A confirmation right after played is refused with AD_BREAK_NOT_FINISHED, so advertiser completion numbers are not inflated by the start call.',
  })
  @ApiHeader({ name: 'X-Guest-Key', required: false, description: 'Must match the key the session was opened with' })
  @ApiOkResponse({ type: AdBreakPlayedViewDto })
  completed(
    @Param('sessionId', ID) sessionId: string,
    @Param('breakId', ID) breakId: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Headers('x-guest-key') guestKey?: string,
  ) {
    return this.breaks.markCompleted(sessionId, breakId, { userId: user?.id, guestKey });
  }
}
