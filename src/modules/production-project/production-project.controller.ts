import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { ProductionProjectService } from './production-project.service';

@Controller('production-projects')
export class ProductionProjectController {
  constructor(private readonly productionProjectService: ProductionProjectService) {}

  @Post()
  create(@Body() dto: CreateProductionProjectRequestDto) {
    return this.productionProjectService.create(dto);
  }

  @Get(':id')
  findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.productionProjectService.findById(id);
  }
}
