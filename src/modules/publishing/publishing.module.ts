import { Module } from '@nestjs/common';
import { MovieProjectModule } from 'src/modules/movie-project/movie-project.module';
import { PlatformSettingModule } from 'src/modules/platform-setting/platform-setting.module';
import { PriceAlertController } from './price-alert.controller';
import { PricingService } from './pricing.service';
import { PublicationSweepJob } from './publication-sweep.job';
import { PublicationService } from './publication.service';
import { PublishingController } from './publishing.controller';

@Module({
  imports: [MovieProjectModule, PlatformSettingModule],
  controllers: [PublishingController, PriceAlertController],
  providers: [PricingService, PublicationService, PublicationSweepJob],
})
export class PublishingModule {}
