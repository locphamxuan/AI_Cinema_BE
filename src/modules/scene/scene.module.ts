import { Module } from '@nestjs/common';
import { SceneController } from './scene.controller';
import { SceneService } from './scene.service';
import { SceneAdvisorService } from './scene-advisor.service';
import { GeminiTextClient } from 'src/modules/generation-job/providers/gemini-text';

@Module({
  controllers: [SceneController],
  providers: [SceneService, SceneAdvisorService, GeminiTextClient],
  exports: [SceneService],
})
export class SceneModule {}
