import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { MediaIngestService } from './media-ingest.service';

const ID = new ParseUUIDPipe({ version: '4' });

/**
 * The deliveries of an episode, read by the project team. Only the studio delivers (and retries a failed delivery),
 * through /studio-portal, since 08/11/2026.
 */
@ApiTags('media-ingest')
@ApiBearerAuth()
@Controller()
export class MediaIngestController {
  constructor(private readonly media: MediaIngestService) {}

  @Get('episodes/:episodeId/media')
  @ApiOperation({ summary: 'Every delivered version of an episode, newest first, with its processing steps' })
  list(@Param('episodeId', ID) episodeId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.list(episodeId, user);
  }

  @Get('media-assets/:mediaAssetId')
  @ApiOperation({ summary: 'One delivered version with its processing steps' })
  get(@Param('mediaAssetId', ID) mediaAssetId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.get(mediaAssetId, user);
  }
}
