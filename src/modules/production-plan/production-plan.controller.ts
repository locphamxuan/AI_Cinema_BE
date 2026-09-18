import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateProductionPlanRequestDto } from './dto/create-production-plan.request.dto';
import { ProductionPlanService } from './production-plan.service';

@Controller('production-projects/:projectId/plans')
export class ProductionPlanController {
  constructor(private readonly productionPlanService: ProductionPlanService) {}

  @Post()
  create(@Param('projectId', new ParseUUIDPipe()) projectId: string, @Body() dto: CreateProductionPlanRequestDto) {
    return this.productionPlanService.create(projectId, dto);
  }
}
