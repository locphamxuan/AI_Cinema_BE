import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateCatalogRequestDto } from './dto/create-catalog.request.dto';
import { UpdateCatalogEpisodeRequestDto } from './dto/update-catalog-episode.request.dto';
import { CatalogService } from './catalog.service';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('episode-packages/:packageId/catalog')
  @Roles(...REVIEWER_ROLES)
  async createFromPackage(
    @Param('packageId') packageId: string,
    @Body() dto: CreateCatalogRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.catalogService.createFromPackage(packageId, dto, userId);
  }

  @Get('movies')
  @Public()
  async findAllMovies(@Paginate() query: PaginateQuery) {
    return this.catalogService.findAllMovies(query);
  }

  @Get('movies/:movieId')
  @Public()
  async findMovieById(@Param('movieId', ParseUUIDPipe) movieId: string) {
    return this.catalogService.findMovieById(movieId);
  }

  @Get('catalog/episodes/:episodeId')
  @Roles(...MF1_ROLES)
  async findEpisodeById(@Param('episodeId') episodeId: string) {
    return this.catalogService.findEpisodeById(episodeId);
  }

  @Get('catalog/episodes/:episodeId/subtitles/:language')
  @Public()
  @Header('Content-Type', 'text/vtt; charset=utf-8')
  async findEpisodeSubtitle(@Param('episodeId', ParseUUIDPipe) episodeId: string, @Param('language') language: string) {
    return this.catalogService.findEpisodeSubtitle(episodeId, language);
  }

  @Patch('catalog/episodes/:episodeId')
  @Roles(...REVIEWER_ROLES)
  async updateEpisode(@Param('episodeId') episodeId: string, @Body() dto: UpdateCatalogEpisodeRequestDto) {
    return this.catalogService.updateEpisode(episodeId, dto);
  }
}
