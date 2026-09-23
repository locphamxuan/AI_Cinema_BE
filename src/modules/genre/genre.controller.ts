import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { GenreDto } from './dto/genre.dto';
import { GenreService } from './genre.service';

@ApiTags('genres')
@ApiBearerAuth()
@Controller('genres')
export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  @Get()
  @ApiPaginatedResponse(GenreDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.genreService.findAll(query);
  }
}
