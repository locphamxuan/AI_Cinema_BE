import { Module } from '@nestjs/common';
import { GenerationJobController } from './generation-job.controller';
import { GenerationJobService } from './generation-job.service';
import { AiModelModule } from 'src/modules/ai-model/ai-model.module';
import { GenreStyleModelModule } from 'src/modules/genre-style-model/genre-style-model.module';

@Module({
  imports: [AiModelModule, GenreStyleModelModule],
  controllers: [GenerationJobController],
  providers: [GenerationJobService],
})
export class GenerationJobModule {}
