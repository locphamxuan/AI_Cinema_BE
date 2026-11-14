import { MovieProjectModule } from 'src/modules/production/movie-project/movie-project.module';
import { Module } from '@nestjs/common';
import { ContractModule } from 'src/modules/production/contract/contract.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ScriptController } from './script.controller';
import { ScriptService } from './script.service';

@Module({
  imports: [ContractModule, StudioModule, MovieProjectModule],
  controllers: [ScriptController],
  providers: [ScriptService],
  exports: [ScriptService],
})
export class ScriptModule {}
