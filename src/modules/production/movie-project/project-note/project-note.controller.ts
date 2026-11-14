import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { SendEpisodeNoteRequestDto } from '../episode-note/dto/episode-note.request.dto';
import { ProjectNoteService } from './project-note.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-1 §1: the Admin and the lead Creator align on the idea of the movie; the Reviewer follows along. */
@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller('projects/:projectId/notes')
export class ProjectNoteController {
  constructor(private readonly notes: ProjectNoteService) {}

  @Get()
  @ApiOperation({ summary: 'Idea and direction notes of the project, oldest first' })
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.list(projectId, user);
  }

  @Post()
  @ApiOperation({ summary: 'Admin, lead Creator or Reviewer: write a note on the idea and direction' })
  send(
    @Param('projectId', ID) projectId: string,
    @Body() dto: SendEpisodeNoteRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notes.send(projectId, dto.message, user);
  }
}
