import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GenreDto } from 'src/modules/genre/dto/genre.dto';
import { GenreService } from 'src/modules/genre/genre.service';

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
