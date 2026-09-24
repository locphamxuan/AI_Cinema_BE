import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { GenreStyleModelDto } from './dto/genre-style-model.dto';
import { CreateGenreStyleModelRequestDto } from './dto/create-genre-style-model.request.dto';
import { AddTrainingSampleRequestDto } from './dto/add-training-sample.request.dto';
import { StartTrainingRequestDto } from './dto/start-training.request.dto';
import { CompleteTrainingRequestDto } from './dto/complete-training.request.dto';
import { GenreStyleModelService } from './genre-style-model.service';

@ApiTags('genre-style-models')
@ApiBearerAuth()
@Controller('genre-style-models')
export class GenreStyleModelController {
  constructor(private readonly genreStyleModelService: GenreStyleModelService) {}

  @Post()
  async create(@Body() dto: CreateGenreStyleModelRequestDto) {
    return this.genreStyleModelService.create(dto);
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
  async addTrainingSample(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTrainingSampleRequestDto) {
    return this.genreStyleModelService.addTrainingSample(id, dto);
  }

  @Post(':id/import-dataset')
  @Roles(UserRole.CONTENT_REVIEWER, UserRole.ADMIN)
  async importDatasetFolder(@Param('id', ParseUUIDPipe) id: string) {
    return this.genreStyleModelService.importDatasetFolder(id);
  }

  @Post(':id/start-training')
  async startTraining(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartTrainingRequestDto) {
    return this.genreStyleModelService.startTraining(id, dto);
  }

  @Post(':id/complete-training')
  async completeTraining(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteTrainingRequestDto) {
    return this.genreStyleModelService.completeTraining(id, dto);
  }
}
