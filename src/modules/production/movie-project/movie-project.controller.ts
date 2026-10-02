import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { CreateMovieProjectRequestDto } from './dto/create-movie-project.request.dto';
import { AssignCreatorRequestDto, ReasonRequestDto } from './dto/project-actions.request.dto';
import { MovieProjectSummaryDto } from './dto/movie-project-summary.dto';
import { UpdateMovieProjectRequestDto } from './dto/update-movie-project.request.dto';
import { MovieProjectService } from './movie-project.service';
import { ProjectLifecycleService } from './project-lifecycle.service';

const ID = new ParseUUIDPipe({ version: '4' });

/**
 * Movie projects (MF-1 steps 1–2, §4.1.2). Reviewers see their own projects, Creators the
 * ones assigned to them and the Admin every project (read-only, BR-55).
 */
@ApiTags('movie-projects')
@ApiBearerAuth()
@Controller('projects')
export class MovieProjectController {
  constructor(
    private readonly projects: MovieProjectService,
    private readonly lifecycle: ProjectLifecycleService,
  ) {}

  @Post()
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Create a movie project with its seasons and episodes (step 1)' })
  create(@Body() dto: CreateMovieProjectRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Projects the caller may see, newest activity first' })
  @ApiPaginatedResponse(MovieProjectSummaryDto, { filterableColumns: { status: ['$eq', '$in'], creatorId: ['$eq'] } })
  list(@Paginate() query: PaginateQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.list(query, user);
  }

  @Get(':movieId')
  detail(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.detail(movieId, user);
  }

  @Patch(':movieId')
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Edit the project and its catalog metadata (synopsis, age rating)' })
  update(
    @Param('movieId', ID) movieId: string,
    @Body() dto: UpdateMovieProjectRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.update(movieId, dto, user);
  }

  @Post(':movieId/assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Assign (or reassign) the Content Creator; needs a production fee (step 2, BR-12)' })
  assign(
    @Param('movieId', ID) movieId: string,
    @Body() dto: AssignCreatorRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lifecycle.assignCreator(movieId, dto.creatorId, user);
  }

  @Post(':movieId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION.PROJECT_MANAGE)
  @ApiOperation({ summary: 'Cancel a project none of whose episodes was published (BR-39)' })
  cancel(@Param('movieId', ID) movieId: string, @Body() dto: ReasonRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.lifecycle.cancel(movieId, dto.reason, user);
  }

  @Get(':movieId/events')
  @ApiOperation({ summary: 'Content events of the project (§4.1.6), newest first' })
  events(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.events(movieId, user);
  }
}
