import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { GenreStyleModelDto } from './dto/genre-style-model.dto';
import { CreateGenreStyleModelRequestDto } from './dto/create-genre-style-model.request.dto';
import { AddTrainingSampleRequestDto } from './dto/add-training-sample.request.dto';
import { CompleteTrainingRequestDto } from './dto/complete-training.request.dto';
import { GenreStyleModelService } from './genre-style-model.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('genre-style-models')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller('genre-style-models')
export class GenreStyleModelController {
  constructor(private readonly genreStyleModelService: GenreStyleModelService) {}

  @Post()
  @RequirePermission(PERMISSION.GENRE_STYLE_MANAGE)
  async create(@Body() dto: CreateGenreStyleModelRequestDto, @CurrentUser('id') userId: string) {
    return this.genreStyleModelService.create(dto, userId);
  }

  @Get()
  @ApiPaginatedResponse(GenreStyleModelDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.genreStyleModelService.findAll(query);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.genreStyleModelService.findById(id);
  }

  @Post(':id/training-samples')
  @RequirePermission(PERMISSION.GENRE_STYLE_MANAGE)
  async addTrainingSample(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTrainingSampleRequestDto) {
    return this.genreStyleModelService.addTrainingSample(id, dto);
  }

  @Post(':id/import-dataset')
  @RequirePermission(PERMISSION.GENRE_STYLE_MANAGE)
  async importDatasetFolder(@Param('id', ParseUUIDPipe) id: string) {
    return this.genreStyleModelService.importDatasetFolder(id);
  }

  @Post(':id/start-training')
  @RequirePermission(PERMISSION.GENRE_STYLE_MANAGE)
  async startTraining(@Param('id', ParseUUIDPipe) id: string) {
    return this.genreStyleModelService.startTraining(id);
  }

  @Post(':id/complete-training')
  @RequirePermission(PERMISSION.GENRE_STYLE_MANAGE)
  async completeTraining(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteTrainingRequestDto) {
    return this.genreStyleModelService.completeTraining(id, dto);
  }
}
