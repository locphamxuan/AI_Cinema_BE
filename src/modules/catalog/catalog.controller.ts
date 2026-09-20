import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CreateCatalogRequestDto } from './dto/create-catalog.request.dto';
import { UpdateCatalogEpisodeRequestDto } from './dto/update-catalog-episode.request.dto';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('episode-packages/:packageId/catalog')
  async createFromPackage(@Param('packageId') packageId: string, @Body() dto: CreateCatalogRequestDto) {
    return this.catalogService.createFromPackage(packageId, dto);
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
