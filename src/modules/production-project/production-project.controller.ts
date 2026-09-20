import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';
import { ProductionProjectService } from './production-project.service';

@ApiTags('production-projects')
@Controller('production-projects')
export class ProductionProjectController {
  constructor(private readonly productionProjectService: ProductionProjectService) {}

  @Post()
  async create(@Body() dto: CreateProductionProjectRequestDto) {
    return this.productionProjectService.create(dto);
  }

  @Get()
  @ApiPaginatedResponse(Object)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.productionProjectService.findAll(query);
  }

  @Get(':projectId')
  async findDetail(@Param('projectId') projectId: string) {
    return this.productionProjectService.findDetail(projectId);
  }

  @Patch(':projectId')
  async update(@Param('projectId') projectId: string, @Body() dto: UpdateProductionProjectRequestDto) {
    return this.productionProjectService.update(projectId, dto);
  }

  @Post(':projectId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('projectId') projectId: string, @Body() dto: CancelProductionProjectRequestDto) {
    return this.productionProjectService.cancel(projectId, dto);
  }
}
