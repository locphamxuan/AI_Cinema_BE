import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { AdBreakController } from './ad-break.controller';
import { AdBreakService } from './ad-break.service';
import { AdCatalogController } from './ad-catalog.controller';
import { AdCatalogService } from './ad-catalog.service';

/** Phase 4 of Main Flow 3: mid-roll scheduling, impressions and the minimal ad catalog. */
@Module({
  imports: [PlatformSettingModule],
  controllers: [AdBreakController, AdCatalogController],
  providers: [AdBreakService, AdCatalogService],
  exports: [AdBreakService, AdCatalogService],
})
export class AdBreakModule {}
