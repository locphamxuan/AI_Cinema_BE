import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { StudioPosterService } from './studio-poster.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** The Reviewer in charge and the Admin download the poster the studio sent, then set it as the movie poster. */
@ApiTags('movie-projects')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PROJECT_MANAGE, PERMISSION.PROJECT_READ_ALL)
@Controller()
export class StudioPosterController {
  constructor(private readonly posters: StudioPosterService) {}

  @Get('projects/:projectId/studio-poster/content')
  @ApiOperation({ summary: 'Download the poster image the studio sent with its film' })
  content(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.posters.download(projectId, user);
  }
}
