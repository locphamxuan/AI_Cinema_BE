import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { Public } from 'src/common/decorators/public.decorator';
import { CatalogService } from './catalog.service';

const ID = new ParseUUIDPipe({ version: '4' });

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('movies')
  @ApiQuery({ name: 'genreId', required: false })
  @ApiOperation({ summary: 'Movies with at least one released episode; search, filter by genre and age rating' })
  movies(@Paginate() query: PaginateQuery, @Query('genreId', new ParseUUIDPipe({ optional: true })) genreId?: string) {
    return this.catalog.listMovies(query, genreId);
  }

  @Get('movies/:movieId')
  @ApiOperation({ summary: 'A listed movie with its seasons' })
  movie(@Param('movieId', ID) movieId: string) {
    return this.catalog.movie(movieId);
  }

  @Get('movies/:movieId/seasons')
  seasons(@Param('movieId', ID) movieId: string) {
    return this.catalog.seasons(movieId);
  }

  @Get('movies/:movieId/episodes')
  @ApiQuery({ name: 'season', required: false, type: Number })
  @ApiOperation({ summary: 'Released episodes, with free-starter flag, AI label and the under-maintenance notice' })
  episodes(
    @Param('movieId', ID) movieId: string,
    @Query('season', new ParseIntPipe({ optional: true })) season?: number,
  ) {
    return this.catalog.episodes(movieId, season);
  }

  @Get('episodes/:episodeId')
  @ApiOperation({ summary: 'A released episode, or one under maintenance (BR-56)' })
  episode(@Param('episodeId', ID) episodeId: string) {
    return this.catalog.episode(episodeId);
  }
}
