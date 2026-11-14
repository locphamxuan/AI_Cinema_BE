import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { EpisodeAdSlotService } from './episode-ad-slot.service';
import { EpisodeAdSlotsViewDto } from 'src/modules/playback/ad-break/dto/episode-ad-slots.view.dto';
import { SetEpisodeAdSlotsRequestDto } from 'src/modules/playback/ad-break/dto/set-episode-ad-slots.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('admin-ads')
@ApiBearerAuth()
@Controller('admin/episodes/:episodeId/ad-slots')
export class EpisodeAdSlotController {
  constructor(private readonly slots: EpisodeAdSlotService) {}

  @Get()
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({ summary: 'Where the mid-roll ads of an episode are inserted (BR-32)' })
  @ApiOkResponse({ type: EpisodeAdSlotsViewDto })
  list(@Param('episodeId', ID) episodeId: string) {
    return this.slots.slots(episodeId);
  }

  @Put()
  @RequirePermission(PERMISSION.AD_MANAGE)
  @ApiOperation({
    summary: 'Place the mid-roll ads of an episode: one cue per insertion, optionally pinned to an ad',
    description: 'Replaces every cue of the episode. An empty list goes back to random cues.',
  })
  @ApiOkResponse({ type: EpisodeAdSlotsViewDto })
  replace(
    @Param('episodeId', ID) episodeId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: SetEpisodeAdSlotsRequestDto,
  ) {
    return this.slots.replace(episodeId, actorId, dto);
  }
}
