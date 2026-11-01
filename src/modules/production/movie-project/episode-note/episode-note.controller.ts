import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { SendEpisodeNoteRequestDto } from './dto/episode-note.request.dto';
import { EpisodeNoteService } from './episode-note.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** BR-67: the Creator holding an episode and the lead Creator exchange notes on it. */
@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller('episodes/:episodeId/notes')
export class EpisodeNoteController {
  constructor(private readonly notes: EpisodeNoteService) {}

  @Get()
  @ApiOperation({ summary: 'Notes between the Creator holding the episode and the lead Creator, oldest first' })
  list(@Param('episodeId', ID) episodeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.list(episodeId, user);
  }

  @Post()
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Send a note: the Creator holding the episode to the lead, or the lead back' })
  send(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: SendEpisodeNoteRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notes.send(episodeId, dto.message, user);
  }
}
