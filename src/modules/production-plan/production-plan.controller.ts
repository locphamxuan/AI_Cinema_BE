import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateProductionPlanRequestDto } from './dto/update-production-plan.request.dto';
import { SubmitProductionPlanRequestDto } from './dto/submit-production-plan.request.dto';
import { CreateProductionPlanRevisionRequestDto } from './dto/create-production-plan-revision.request.dto';
import { CreateSceneRequestDto } from 'src/modules/scene/dto/create-scene.request.dto';
import { ProductionPlanService } from './production-plan.service';
import { SceneService } from 'src/modules/scene/scene.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CREATOR_ROLES, MF1_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('production-plans')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class ProductionPlanController {
  constructor(
    private readonly productionPlanService: ProductionPlanService,
    private readonly sceneService: SceneService,
  ) {}

  @Get('production-projects/:projectId/plans')
  async findAll(@Param('projectId') projectId: string, @Paginate() query: PaginateQuery) {
    return this.productionPlanService.findAll(projectId, query);
  }

  @Get('production-plans/:planId')
  async findById(@Param('planId') planId: string) {
    return this.productionPlanService.findById(planId, true);
  }

  @Patch('production-plans/:planId')
  @Roles(...CREATOR_ROLES)
  async update(@Param('planId') planId: string, @Body() dto: UpdateProductionPlanRequestDto) {
    return this.productionPlanService.update(planId, dto);
  }

  @Post('production-plans/:planId/submit')
  @Roles(...CREATOR_ROLES)
  async submit(@Param('planId') planId: string, @Body() dto: SubmitProductionPlanRequestDto) {
    return this.productionPlanService.submit(planId, dto);
  }

  @Post('production-projects/:projectId/plans/:planId/revisions')
  @Roles(...CREATOR_ROLES)
  async createRevision(
    @Param('projectId') projectId: string,
    @Param('planId') planId: string,
    @Body() dto: CreateProductionPlanRevisionRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.productionPlanService.createRevision(projectId, planId, dto, userId);
  }

  @Post('production-plans/:planId/scenes')
  @Roles(...CREATOR_ROLES)
  async addScene(@Param('planId') planId: string, @Body() dto: CreateSceneRequestDto) {
    return this.sceneService.create(planId, dto);
  }
}
