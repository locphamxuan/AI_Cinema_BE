import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import {
  AddCreatorRequestDto,
  AssignEpisodeRequestDto,
  DelegateEpisodesRequestDto,
} from './dto/project-team.request.dto';
import { ProjectTeamService } from './project-team.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** Several Content Creators per project, episodes given to one of them, and delegation between them (BR-13). */
@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller()
export class ProjectTeamController {
  constructor(private readonly team: ProjectTeamService) {}

  @Get('creators')
  @RequirePermission(PERMISSION.PROJECT_MANAGE, PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Active Content Creators a project can add or delegate episodes to' })
  directory() {
    return this.team.directory();
  }

  @Get('projects/:projectId/creators')
  @ApiOperation({ summary: 'Creators of the project with their episodes, who added them and who delegated' })
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.team.list(projectId, user);
  }

  @Post('projects/:projectId/creators')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Add a Content Creator next to the lead Creator (Reviewer)' })
  add(
    @Param('projectId', ID) projectId: string,
    @Body() dto: AddCreatorRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.addCreator(projectId, dto, user);
  }

  @Delete('projects/:projectId/creators/:creatorId')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Take a Creator off the project; their episodes go back to the team (Reviewer)' })
  remove(
    @Param('projectId', ID) projectId: string,
    @Param('creatorId', ID) creatorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.removeCreator(projectId, creatorId, user);
  }

  @Post('projects/:projectId/delegations')
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Creator 1 delegates episodes to Creator 2' })
  delegate(
    @Param('projectId', ID) projectId: string,
    @Body() dto: DelegateEpisodesRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.delegate(projectId, dto, user);
  }

  @Put('episodes/:episodeId/assignee')
  @RequirePermission(PERMISSION.PROJECT_MANAGE, PERMISSION.MEDIA_INGEST)
  @ApiOperation({
    summary: 'Give an episode to a Creator of the project, or back to the team (Reviewer or lead Creator)',
  })
  assignEpisode(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: AssignEpisodeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.assignEpisode(episodeId, dto.creatorId, user);
  }
}
