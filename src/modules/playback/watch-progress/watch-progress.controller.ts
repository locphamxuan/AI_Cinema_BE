import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { WatchProgressService } from './watch-progress.service';
import { ProgressViewDto } from 'src/modules/playback/watch-progress/dto/progress.view.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Members only: guests keep no progress and always restart from 0. */
@ApiTags('playback')
@ApiBearerAuth()
@Controller('playback')
export class WatchProgressController {
  constructor(private readonly progress: WatchProgressService) {}

  @Get('episodes/:episodeId/progress')
  @ApiOperation({ summary: 'Saved resume position for an episode (flow 3, step 8)' })
  @ApiOkResponse({ type: ProgressViewDto })
  saved(@Param('episodeId', ID) episodeId: string, @CurrentUser('id') userId: string) {
    return this.progress.progress(userId, episodeId);
  }

  @Get('history')
  @ApiOperation({ summary: "Member's watch history, newest first" })
  history(@Paginate() query: PaginateQuery, @CurrentUser('id') userId: string) {
    return this.progress.history(userId, query);
  }
}
