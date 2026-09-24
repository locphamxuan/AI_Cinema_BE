import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateProductionProjectRequestDto } from './dto/create-production-project.request.dto';
import { UpdateProductionProjectRequestDto } from './dto/update-production-project.request.dto';
import { CancelProductionProjectRequestDto } from './dto/cancel-production-project.request.dto';
import { ProductionProjectService } from './production-project.service';
import { MF1_ROLES, REVIEWER_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('production-projects')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller('production-projects')
export class ProductionProjectController {
  constructor(private readonly productionProjectService: ProductionProjectService) {}

  @Post()
  @Roles(...REVIEWER_ROLES)
  async create(@Body() dto: CreateProductionProjectRequestDto, @CurrentUser('id') userId: string) {
    return this.productionProjectService.create(dto, userId);
  }

  @Get()
  @ApiPaginatedResponse(Object)
  async findAll(@Paginate() query: PaginateQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.productionProjectService.findAll(query, user);
  }

  @Get(':projectId')
  async findDetail(@Param('projectId') projectId: string) {
    return this.productionProjectService.findDetail(projectId);
  }

  @Patch(':projectId')
  @Roles(...REVIEWER_ROLES)
  async update(@Param('projectId') projectId: string, @Body() dto: UpdateProductionProjectRequestDto) {
    return this.productionProjectService.update(projectId, dto);
  }

  @Post(':projectId/cancel')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('projectId') projectId: string, @Body() dto: CancelProductionProjectRequestDto) {
    return this.productionProjectService.cancel(projectId, dto);
  }
}
