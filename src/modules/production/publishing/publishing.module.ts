import { Module } from '@nestjs/common';
import { EntitlementModule } from 'src/modules/episode-access/entitlement/entitlement.module';
import { ContentReviewModule } from 'src/modules/production/content-review/content-review.module';
import { MovieProjectModule } from 'src/modules/production/movie-project/movie-project.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { EpisodeRevisionService } from './episode-revision.service';
import { PriceAlertController } from './price-alert.controller';
import { PricingService } from './pricing.service';
import { PublicationSweepJob } from './publication-sweep.job';
import { PublicationService } from './publication.service';
import { PublishingController } from './publishing.controller';

@Module({
  imports: [MovieProjectModule, PlatformSettingModule, ContentReviewModule, EntitlementModule],
  controllers: [PublishingController, PriceAlertController],
  providers: [PricingService, PublicationService, EpisodeRevisionService, PublicationSweepJob],
})
export class PublishingModule {}
