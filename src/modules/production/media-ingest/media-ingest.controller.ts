import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LabelType } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { RemoveTempUploadInterceptor } from 'src/common/http/remove-temp-upload.interceptor';
import {
  parseAiDisclosure,
  SubmitMediaLinkRequestDto,
  SubmitMediaUploadRequestDto,
} from './dto/submit-media.request.dto';
import { MediaIngestService } from './media-ingest.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('media-ingest')
@ApiBearerAuth()
@Controller()
export class MediaIngestController {
  constructor(private readonly media: MediaIngestService) {}

  @Post('episodes/:episodeId/media')
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Deliver an episode by HLS link or import URL, with the AI Disclosure (steps 5–6)' })
  submitLink(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: SubmitMediaLinkRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.submitLink(episodeId, dto, user);
  }

  @Post('episodes/:episodeId/media/upload')
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @UseInterceptors(FileInterceptor('file'), RemoveTempUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'aiDisclosure', 'proposedLabelType'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'MP4 or MOV' },
        aiDisclosure: { type: 'string', description: 'JSON of the AI Disclosure (BR-41)' },
        proposedLabelType: { type: 'string', enum: Object.values(LabelType) },
        submissionNote: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Deliver an episode as an MP4/MOV file; it is transcoded to HLS (steps 5–6)' })
  submitUpload(
    @Param('episodeId', ID) episodeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SubmitMediaUploadRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.submitUpload(episodeId, file, dto, parseAiDisclosure(dto.aiDisclosure), user);
  }

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

  @Post('media-assets/:mediaAssetId/retry')
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Process a failed delivery again (latest version only)' })
  retry(@Param('mediaAssetId', ID) mediaAssetId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.retry(mediaAssetId, user);
  }
}
