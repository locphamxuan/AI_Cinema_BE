import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UpdateSceneRequestDto } from './dto/update-scene.request.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene.request.dto';
import { SceneService } from './scene.service';

@ApiTags('scenes')
@Controller()
export class SceneController {
  constructor(private readonly sceneService: SceneService) {}

  @Patch('scenes/:sceneId')
  async update(@Param('sceneId') sceneId: string, @Body() dto: UpdateSceneRequestDto) {
    return this.sceneService.update(sceneId, dto);
  }

  @Delete('scenes/:sceneId')
  async remove(@Param('sceneId') sceneId: string) {
    return this.sceneService.remove(sceneId);
  }

  @Post('scenes/:sceneId/submit')
  async submit(@Param('sceneId') sceneId: string, @Body() dto: SubmitSceneRequestDto) {
    return this.sceneService.submit(sceneId, dto);
  }
}
