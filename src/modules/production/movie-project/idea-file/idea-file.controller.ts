import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  ParseUUIDPipe,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IdeaFilePurpose } from '@prisma/client';
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
@Controller('projects/:projectId/idea-files')
export class IdeaFileController {
  constructor(private readonly ideaFiles: IdeaFileService) {}

  @Post()
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IDEA_FILE_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary:
      'Upload an idea or synopsis file (?purpose=IDEA|SYNOPSIS; documents, TXT, images, video; ≤ 100 MB); same name = new version',
  })
  upload(
    @Param('projectId', ID) projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Query('purpose', new ParseEnumPipe(IdeaFilePurpose, { optional: true })) purpose?: IdeaFilePurpose,
  ) {
    return this.ideaFiles.upload(projectId, file, user, purpose);
  }

  @Get()
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ideaFiles.list(projectId, user);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Remove an idea or synopsis file version while the project is open' })
  remove(
    @Param('projectId', ID) projectId: string,
    @Param('fileId', ID) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ideaFiles.remove(projectId, fileId, user);
  }

  @Get(':fileId/content')
  @ApiOperation({ summary: 'Download an idea file' })
  download(
    @Param('projectId', ID) projectId: string,
    @Param('fileId', ID) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ideaFiles.download(projectId, fileId, user);
  }
}
