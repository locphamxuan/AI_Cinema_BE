import { Module } from '@nestjs/common';
import { ContractModule } from 'src/modules/production/contract/contract.module';
import { EpisodeUploadMulter, MediaIngestModule } from 'src/modules/production/media-ingest/media-ingest.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { StudioPortalController } from './studio-portal.controller';
import { StudioPortalService } from './studio-portal.service';
import { StudioPosterController } from './poster/studio-poster.controller';
import { StudioPosterService } from './poster/studio-poster.service';
import { StudioProfileController } from './profile/studio-profile.controller';
import { StudioProfileService } from './profile/studio-profile.service';

@Module({
  imports: [EpisodeUploadMulter, ContractModule, MediaIngestModule, StudioModule],
  controllers: [StudioPortalController, StudioPosterController, StudioProfileController],
  providers: [StudioPortalService, StudioPosterService, StudioProfileService],
})
export class StudioPortalModule {}
