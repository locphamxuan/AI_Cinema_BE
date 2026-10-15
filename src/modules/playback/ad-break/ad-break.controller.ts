import { Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { OptionalUser } from 'src/common/decorators/optional-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { AdBreakService } from './ad-break.service';
import { AdBreakPlayedViewDto } from 'src/modules/playback/ad-break/dto/ad-break-played.view.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Public like the session routes: ownership is checked against the session row. */
@ApiTags('playback')
@Public()
@Controller('playback')
export class AdBreakController {
  constructor(private readonly breaks: AdBreakService) {}

  @Post('sessions/:sessionId/ad-breaks/:breakId/played')
  @ApiOperation({ summary: 'Player reached the cue: play the ad and count the impression (flow 3, step 17)' })
  @ApiHeader({ name: 'X-Guest-Key', required: false, description: 'Must match the key the session was opened with' })
  @ApiOkResponse({ type: AdBreakPlayedViewDto })
  played(
    @Param('sessionId', ID) sessionId: string,
    @Param('breakId', ID) breakId: string,
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Headers('x-guest-key') guestKey?: string,
  ) {
    return this.breaks.markPlayed(sessionId, breakId, { userId: user?.id, guestKey });
  }
}
