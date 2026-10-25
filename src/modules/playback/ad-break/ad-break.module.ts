import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AdBreakController } from './ad-break.controller';
import { AdBreakService } from './ad-break.service';
import { AdCatalogController } from './ad-catalog.controller';
import { AdCatalogService } from './ad-catalog.service';
import { EpisodeAdSlotController } from './episode-ad-slot.controller';
import { EpisodeAdSlotService } from './episode-ad-slot.service';

/** Phase 4 of Main Flow 3: mid-roll scheduling, impressions, the ad catalog and per-episode cues. */
@Module({
  imports: [PlatformSettingModule, AuditLogModule],
  controllers: [AdBreakController, AdCatalogController, EpisodeAdSlotController],
  providers: [AdBreakService, AdCatalogService, EpisodeAdSlotService],
  exports: [AdBreakService, AdCatalogService],
})
export class AdBreakModule {}
