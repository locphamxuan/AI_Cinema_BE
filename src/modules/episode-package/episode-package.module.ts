import { Module } from '@nestjs/common';
import { EpisodePackageController } from './episode-package.controller';
import { EpisodePackageService } from './episode-package.service';

@Module({
  controllers: [EpisodePackageController],
  providers: [EpisodePackageService],
})
export class EpisodePackageModule {}
