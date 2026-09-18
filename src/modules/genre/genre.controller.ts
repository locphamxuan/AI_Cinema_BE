import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { GenreDto } from './dto/genre.dto';
import { GenreService } from './genre.service';

@ApiTags('genres')
@Controller('genres')
export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  @Get()
  @ApiPaginatedResponse(GenreDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.genreService.findAll(query);
  }
}
