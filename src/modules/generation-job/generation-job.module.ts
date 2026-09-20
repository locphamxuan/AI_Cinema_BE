import { Module } from '@nestjs/common';
import { GenerationJobController } from './generation-job.controller';
import { GenerationJobService } from './generation-job.service';

@Module({
  controllers: [GenerationJobController],
  providers: [GenerationJobService],
})
export class GenerationJobModule {}
