import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { BriefService } from './brief/brief.service';
import { FilmSentController } from './film-sent/film-sent.controller';
import { FilmSentService } from './film-sent/film-sent.service';
import { HandoffMaterialService } from './material/handoff-material.service';
import { MilestoneService } from './milestone/milestone.service';
import { OverdueEpisodesJob } from './overdue-episodes.job';
import { StudioHandoffController } from './studio-handoff.controller';
import { StudioHandoffService } from './studio-handoff.service';

@Module({
  imports: [ProductionCostModule, StudioModule],
  controllers: [StudioHandoffController, FilmSentController],
  providers: [
    StudioHandoffService,
    MilestoneService,
    HandoffMaterialService,
    BriefService,
    FilmSentService,
    OverdueEpisodesJob,
  ],
})
export class StudioHandoffModule {}
