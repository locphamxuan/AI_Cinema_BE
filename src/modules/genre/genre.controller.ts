import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { REVIEWER_ROLES } from 'src/common/auth/mf1-roles';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { GenreDto } from './dto/genre.dto';
import { CreateGenreRequestDto } from './dto/create-genre.request.dto';
import { GenreService } from './genre.service';

@ApiTags('genres')
@Controller('genres')
export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  @Get()
  @Public()
  @ApiPaginatedResponse(GenreDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.genreService.findAll(query);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(...REVIEWER_ROLES)
  @ApiOperation({
    summary: 'Add a genre the list does not have yet (Content Reviewer, when creating a project)',
    description: 'A name that already exists, ignoring case, returns that genre instead of a duplicate.',
  })
  async create(@Body() dto: CreateGenreRequestDto) {
    return this.genreService.create(dto);
  }
}
