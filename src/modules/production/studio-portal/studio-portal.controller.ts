import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LabelType } from '@prisma/client';
import { Public } from 'src/common/decorators/public.decorator';
import { RemoveTempUploadInterceptor } from 'src/common/http/remove-temp-upload.interceptor';
import {
  parseAiDisclosure,
  SubmitMediaLinkRequestDto,
  SubmitMediaUploadRequestDto,
} from 'src/modules/production/media-ingest/dto/submit-media.request.dto';
import { RespondToHandoffRequestDto } from './dto/studio-portal.request.dto';
import { StudioPortalService } from './studio-portal.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** The outside studio's side of MF-1: no account, the link from the brief email is the credential. */
@ApiTags('studio-portal')
@Public()
@Controller('studio-portal/:token')
export class StudioPortalController {
  constructor(private readonly portal: StudioPortalService) {}

  @Get()
  @ApiOperation({ summary: 'The hand-off as the studio sees it: brief, episodes, deliveries, changes asked' })
  overview(@Param('token') token: string) {
    return this.portal.overview(token);
  }

  @Post('response')
  @ApiOperation({ summary: 'Accept (agreeing to the brief, due dates and terms) or decline with a reason; once' })
  respond(@Param('token') token: string, @Body() dto: RespondToHandoffRequestDto) {
    return this.portal.respond(token, dto);
  }

  @Get('brief')
  @ApiOperation({ summary: 'The brief PDF of this hand-off' })
  brief(@Param('token') token: string) {
    return this.portal.brief(token);
  }

  @Get('idea-files/:fileId')
  ideaFile(@Param('token') token: string, @Param('fileId', ID) fileId: string) {
    return this.portal.ideaFile(token, fileId);
  }

  @Post('episodes/:episodeId/media')
  @ApiOperation({ summary: 'Deliver an episode by HLS link or import URL, with the studio’s AI Disclosure' })
  submitLink(
    @Param('token') token: string,
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: SubmitMediaLinkRequestDto,
  ) {
    return this.portal.submitLink(token, episodeId, dto);
  }

  @Post('episodes/:episodeId/media/upload')
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
  @ApiOperation({ summary: 'Deliver an episode as an MP4/MOV file, with the studio’s AI Disclosure' })
  submitUpload(
    @Param('token') token: string,
    @Param('episodeId', ID) episodeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SubmitMediaUploadRequestDto,
  ) {
    return this.portal.submitUpload(token, episodeId, file, dto, parseAiDisclosure(dto.aiDisclosure));
  }
}
