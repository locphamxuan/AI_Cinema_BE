import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';
import { SceneService } from './scene.service';

@ApiTags('scenes')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller()
export class SceneController {
  constructor(private readonly sceneService: SceneService) {}

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
