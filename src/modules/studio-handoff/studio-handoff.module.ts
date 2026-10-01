import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform-setting/platform-setting.module';
import { ProductionFeeModule } from 'src/modules/production-fee/production-fee.module';
import { BriefService } from './brief.service';
import { OverdueEpisodesJob } from './overdue-episodes.job';
import { StudioHandoffController } from './studio-handoff.controller';
import { StudioHandoffService } from './studio-handoff.service';

@Module({
  imports: [ProductionFeeModule, PlatformSettingModule],
  controllers: [StudioHandoffController],
  providers: [StudioHandoffService, BriefService, OverdueEpisodesJob],
})
export class StudioHandoffModule {}
