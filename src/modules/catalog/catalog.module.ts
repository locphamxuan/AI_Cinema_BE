import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EngagementController } from './engagement/engagement.controller';
import { EngagementService } from './engagement/engagement.service';
import { FilmReportController } from './film-report/film-report.controller';
import { FilmReportService } from './film-report/film-report.service';
import { SubtitleController } from './subtitle/subtitle.controller';

@Module({
  imports: [PlatformSettingModule],
  controllers: [CatalogController, EngagementController, FilmReportController, SubtitleController],
  providers: [CatalogService, EngagementService, FilmReportService],
})
export class CatalogModule {}
