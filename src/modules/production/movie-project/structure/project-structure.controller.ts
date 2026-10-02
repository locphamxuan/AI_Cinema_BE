import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { NewEpisodeDto, NewSeasonDto } from '../dto/create-movie-project.request.dto';
import { UpdateEpisodeRequestDto } from '../dto/project-actions.request.dto';
import { ProjectStructureService } from './project-structure.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('movie-projects')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PROJECT_MANAGE)
@Controller()
export class ProjectStructureController {
  constructor(private readonly structure: ProjectStructureService) {}

  @Post('projects/:movieId/seasons')
  @ApiOperation({ summary: 'Add a season with its episodes (numbering continues across the movie)' })
  addSeason(@Param('movieId', ID) movieId: string, @Body() dto: NewSeasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.structure.addSeason(movieId, dto, user);
  }

  @Post('seasons/:seasonId/episodes')
  addEpisode(
    @Param('seasonId', ID) seasonId: string,
    @Body() dto: NewEpisodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structure.addEpisode(seasonId, dto, user);
  }

  @Patch('episodes/:episodeId')
  @ApiOperation({ summary: 'Edit an episode; the target duration only until it is approved (BR-31)' })
  updateEpisode(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: UpdateEpisodeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.structure.updateEpisode(episodeId, dto, user);
  }
}
