import { Module } from '@nestjs/common';
import { ContractModule } from 'src/modules/production/contract/contract.module';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { BriefService } from './brief/brief.service';
import { HandoffMaterialService } from './material/handoff-material.service';
import { OverdueEpisodesJob } from './overdue-episodes.job';
import { StudioHandoffController } from './studio-handoff.controller';
import { StudioHandoffService } from './studio-handoff.service';

@Module({
  imports: [ProductionCostModule, StudioModule, ContractModule],
  controllers: [StudioHandoffController],
  providers: [StudioHandoffService, HandoffMaterialService, BriefService, OverdueEpisodesJob],
})
export class StudioHandoffModule {}
