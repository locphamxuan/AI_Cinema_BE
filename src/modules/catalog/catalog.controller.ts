import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { UserRole } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateCatalogRequestDto } from './dto/create-catalog.request.dto';
import { UpdateCatalogEpisodeRequestDto } from './dto/update-catalog-episode.request.dto';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('episode-packages/:packageId/catalog')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
  async createFromPackage(
    @Param('packageId') packageId: string,
    @Body() dto: CreateCatalogRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.catalogService.createFromPackage(packageId, dto, userId);
  }

  @Get('movies')
  async findAllMovies(@Paginate() query: PaginateQuery) {
    return this.catalogService.findAllMovies(query);
  }

  @Get('movies/:movieId')
  async findMovieById(@Param('movieId') movieId: string) {
    return this.catalogService.findMovieById(movieId);
  }

  @Get('catalog/episodes/:episodeId')
  async findEpisodeById(@Param('episodeId') episodeId: string) {
    return this.catalogService.findEpisodeById(episodeId);
  }

  @Patch('catalog/episodes/:episodeId')
  async updateEpisode(@Param('episodeId') episodeId: string, @Body() dto: UpdateCatalogEpisodeRequestDto) {
    return this.catalogService.updateEpisode(episodeId, dto);
  }
}
