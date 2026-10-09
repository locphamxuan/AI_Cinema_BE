import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { OptionalUser } from 'src/common/decorators/optional-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { AccessDecisionService } from './access-decision.service';
import { AccessDecisionDto } from './dto/access-decision.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/**
 * Public: a Guest and a Member get the same episode, but a Member also gets the prices and what
 * their wallet is short of. Passing the access token is optional on this route.
 */
@ApiTags('episode-access')
@Public()
@Controller('episodes')
export class AccessDecisionController {
  constructor(private readonly decisions: AccessDecisionService) {}

  @Get(':episodeId/access')
  @ApiOperation({
    summary: 'May this caller watch the episode, and if not, what is left to do (steps 6, 7, 9, 11, 14, 18)',
  })
  @ApiOkResponse({ type: AccessDecisionDto })
  access(@Param('episodeId', ID) episodeId: string, @OptionalUser() user?: AuthenticatedUser) {
    return this.decisions.decide(episodeId, user?.id);
  }
}
