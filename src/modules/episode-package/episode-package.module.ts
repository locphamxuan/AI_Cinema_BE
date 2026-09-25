import { Module } from '@nestjs/common';
import { GenerationJobModule } from 'src/modules/generation-job/generation-job.module';
import { EpisodePackageController } from './episode-package.controller';
import { EpisodePackageService } from './episode-package.service';
import { EpisodeSubtitleService } from './episode-subtitle.service';
import { MockVideoTranscoder, VIDEO_TRANSCODER } from './video-transcoder';

@Module({
  imports: [GenerationJobModule],
  controllers: [EpisodePackageController],
  providers: [
    EpisodePackageService,
    EpisodeSubtitleService,
    { provide: VIDEO_TRANSCODER, useClass: MockVideoTranscoder },
  ],
})
export class EpisodePackageModule {}
