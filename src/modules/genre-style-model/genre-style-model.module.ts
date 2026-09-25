import { Module } from '@nestjs/common';
import { GenreStyleModelController } from './genre-style-model.controller';
import { GenreStyleModelService } from './genre-style-model.service';
import { LORA_TRAINING_PROVIDER, MockLoraTrainingProvider } from './lora-training-provider';

@Module({
  controllers: [GenreStyleModelController],
  providers: [
    GenreStyleModelService,
    {
      provide: LORA_TRAINING_PROVIDER,
      useClass: MockLoraTrainingProvider,
    },
  ],
  exports: [GenreStyleModelService],
})
export class GenreStyleModelModule {}
