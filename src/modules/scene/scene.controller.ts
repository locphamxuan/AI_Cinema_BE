import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';
import { UpdateSceneDirectionRequestDto } from './dto/update-scene-direction.request.dto';
import { SceneService } from './scene.service';
import { SceneAdvisorService } from './scene-advisor.service';

@ApiTags('scenes')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class SceneController {
  constructor(
    private readonly sceneService: SceneService,
    private readonly sceneAdvisor: SceneAdvisorService,
  ) {}

  @Patch('scenes/:sceneId')
  @RequirePermission(PERMISSION.PLAN_WRITE)
  async update(@Param('sceneId') sceneId: string, @Body() dto: UpdateSceneRequestDto) {
    return this.sceneService.update(sceneId, dto);
  }

  @Delete('scenes/:sceneId')
  @RequirePermission(PERMISSION.PLAN_WRITE)
  async remove(@Param('sceneId') sceneId: string) {
    return this.sceneService.remove(sceneId);
  }

  @Patch('scenes/:sceneId/direction')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async updateDirection(@Param('sceneId') sceneId: string, @Body() dto: UpdateSceneDirectionRequestDto) {
    return this.sceneService.updateDirection(sceneId, dto);
  }

  @Post('scenes/:sceneId/reset')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async reset(@Param('sceneId') sceneId: string) {
    return this.sceneService.reset(sceneId);
  }

  @Get('scenes/:sceneId/suggestions')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async suggestions(@Param('sceneId') sceneId: string) {
    return this.sceneAdvisor.advise(sceneId);
  }

  @Get('production-plans/:planId/continuity')
  @RequirePermission(PERMISSION.PRODUCTION_GENERATE)
  async continuity(@Param('planId') planId: string) {
    return this.sceneAdvisor.checkPlan(planId);
  }

  @Post('scenes/:sceneId/submit')
  @RequirePermission(PERMISSION.PLAN_WRITE)
  async submit(
    @Param('sceneId') sceneId: string,
    @Body() dto: SubmitSceneRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.sceneService.submit(sceneId, dto, userId);
  }
}
