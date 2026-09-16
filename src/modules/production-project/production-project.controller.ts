import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';
import { ProductionProjectDto } from './dto/production-project.dto';
import { ProductionProjectService } from './production-project.service';

@ApiTags('production-projects')
@Controller('production-projects')
export class ProductionProjectController {
  constructor(private readonly productionProjectService: ProductionProjectService) {}

  @Post()
  create(@Body() dto: CreateProductionProjectRequestDto) {
    return this.productionProjectService.create(dto);
  }

  @Get()
  @ApiPaginatedResponse(ProductionProjectDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.productionProjectService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.productionProjectService.findDetail(id);
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateProductionProjectRequestDto) {
    return this.productionProjectService.update(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CancelProductionProjectRequestDto) {
    return this.productionProjectService.cancel(id, dto);
  }
}
