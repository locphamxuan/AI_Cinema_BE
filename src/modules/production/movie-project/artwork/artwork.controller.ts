import { Controller, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ARTWORK_MAX_BYTES, ArtworkService } from './artwork.service';

const ID = new ParseUUIDPipe({ version: '4' });
const IMAGE = FileInterceptor('file', { limits: { fileSize: ARTWORK_MAX_BYTES, files: 1 } });
const IMAGE_BODY = { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } };

@ApiTags('movie-projects')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PROJECT_MANAGE)
@Controller()
export class ArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  @Post('projects/:movieId/poster')
  @UseInterceptors(IMAGE)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Upload the poster of the project (PNG, JPEG, WebP; ≤ 5 MB)' })
  poster(
    @Param('movieId', ID) movieId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.artwork.uploadPoster(movieId, file, user);
  }

  @Post('episodes/:episodeId/thumbnail')
  @UseInterceptors(IMAGE)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_BODY)
  @ApiOperation({ summary: 'Upload the thumbnail of an episode (PNG, JPEG, WebP; ≤ 5 MB)' })
  thumbnail(
    @Param('episodeId', ID) episodeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.artwork.uploadThumbnail(episodeId, file, user);
  }
}
