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

  @Get('projects/:movieId/creators')
  @ApiOperation({ summary: 'Creators of the project with their episodes, who added them and who delegated' })
  list(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.team.list(movieId, user);
  }

  @Post('projects/:movieId/creators')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Add a Content Creator next to the lead Creator (Reviewer)' })
  add(
    @Param('movieId', ID) movieId: string,
    @Body() dto: AddCreatorRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.addCreator(movieId, dto, user);
  }

  @Delete('projects/:movieId/creators/:creatorId')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Take a Creator off the project; their episodes go back to the team (Reviewer)' })
  remove(
    @Param('movieId', ID) movieId: string,
    @Param('creatorId', ID) creatorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.removeCreator(movieId, creatorId, user);
  }

  @Post('projects/:movieId/delegations')
  @RequirePermission(PERMISSION.MEDIA_INGEST)
  @ApiOperation({ summary: 'Creator 1 delegates episodes to Creator 2' })
  delegate(
    @Param('movieId', ID) movieId: string,
    @Body() dto: DelegateEpisodesRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.team.delegate(movieId, dto, user);
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
