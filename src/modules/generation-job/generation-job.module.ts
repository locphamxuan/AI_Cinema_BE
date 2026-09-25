import { Module } from '@nestjs/common';
import { GenerationJobController } from './generation-job.controller';
import { GenerationJobService } from './generation-job.service';
import { PROMPT_COMPOSER, MockPromptComposer } from './prompt-composer';
import { AI_GENERATION_PROVIDER } from './ai-generation-provider';
import { MediaStorage } from './providers/media-storage';
import { RoutingAiGenerationProvider } from './providers/routing-ai-generation-provider';
import { AiModelModule } from 'src/modules/ai-model/ai-model.module';
import { GenreStyleModelModule } from 'src/modules/genre-style-model/genre-style-model.module';

@Module({
  imports: [AiModelModule, GenreStyleModelModule],
  controllers: [GenerationJobController],
  providers: [
    GenerationJobService,
    { provide: PROMPT_COMPOSER, useClass: MockPromptComposer },
    MediaStorage,
    { provide: AI_GENERATION_PROVIDER, useClass: RoutingAiGenerationProvider },
  ],
  exports: [GenerationJobService],
})
export class GenerationJobModule {}
