import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';
import { SceneService } from './scene.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CREATOR_ROLES, MF1_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('scenes')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller()
export class SceneController {
  constructor(private readonly sceneService: SceneService) {}

  @Patch('scenes/:sceneId')
  @Roles(...CREATOR_ROLES)
  async update(@Param('sceneId') sceneId: string, @Body() dto: UpdateSceneRequestDto) {
    return this.sceneService.update(sceneId, dto);
  }

  @Delete('scenes/:sceneId')
  @Roles(...CREATOR_ROLES)
  async remove(@Param('sceneId') sceneId: string) {
    return this.sceneService.remove(sceneId);
  }

  @Post('scenes/:sceneId/submit')
  @Roles(...CREATOR_ROLES)
  async submit(
    @Param('sceneId') sceneId: string,
    @Body() dto: SubmitSceneRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.sceneService.submit(sceneId, dto, userId);
  }
}
