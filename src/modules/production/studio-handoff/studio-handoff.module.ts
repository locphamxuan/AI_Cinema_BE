import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { ProductionFeeModule } from 'src/modules/production/production-fee/production-fee.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { BriefService } from './brief/brief.service';
import { HandoffMaterialService } from './material/handoff-material.service';
import { MilestoneService } from './milestone/milestone.service';
import { OverdueEpisodesJob } from './overdue-episodes.job';
import { StudioHandoffController } from './studio-handoff.controller';
import { StudioHandoffService } from './studio-handoff.service';

@Module({
  imports: [ProductionFeeModule, PlatformSettingModule, StudioModule],
  controllers: [StudioHandoffController],
  providers: [StudioHandoffService, MilestoneService, HandoffMaterialService, BriefService, OverdueEpisodesJob],
})
export class StudioHandoffModule {}
