import { Module } from '@nestjs/common';
import { EpisodeUploadMulter, MediaIngestModule } from 'src/modules/production/media-ingest/media-ingest.module';
import { StudioPortalController } from './studio-portal.controller';
import { StudioPortalService } from './studio-portal.service';

@Module({
  imports: [MediaIngestModule, EpisodeUploadMulter],
  controllers: [StudioPortalController],
  providers: [StudioPortalService],
})
export class StudioPortalModule {}
