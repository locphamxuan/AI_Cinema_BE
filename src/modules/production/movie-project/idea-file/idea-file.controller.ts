import { Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { IDEA_FILE_MAX_BYTES, IdeaFileService } from './idea-file.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller('projects/:movieId/idea-files')
export class IdeaFileController {
  constructor(private readonly ideaFiles: IdeaFileService) {}

  @Post()
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IDEA_FILE_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload an idea file (PDF, DOCX, PNG, JPEG, WebP; ≤ 20 MB); same name = new version' })
  upload(
    @Param('movieId', ID) movieId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ideaFiles.upload(movieId, file, user);
  }

  @Get()
  list(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ideaFiles.list(movieId, user);
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: 'Download an idea file' })
  download(
    @Param('movieId', ID) movieId: string,
    @Param('fileId', ID) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ideaFiles.download(movieId, fileId, user);
  }
}
