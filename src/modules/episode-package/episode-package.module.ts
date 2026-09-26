import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationJobModule } from 'src/modules/generation-job/generation-job.module';
import { MediaStorage } from 'src/modules/generation-job/providers/media-storage';
import { EpisodePackageController } from './episode-package.controller';
import { EpisodePackageService } from './episode-package.service';
import { EpisodeSubtitleService } from './episode-subtitle.service';
import { FfmpegVideoTranscoder } from './ffmpeg-transcoder';
import { MockVideoTranscoder, VIDEO_TRANSCODER } from './video-transcoder';

@Module({
  imports: [GenerationJobModule],
  controllers: [EpisodePackageController],
  providers: [
    EpisodePackageService,
    EpisodeSubtitleService,
    {
      // VIDEO_TRANSCODER=ffmpeg renders the real HLS ladder; anything else keeps the mock.
      provide: VIDEO_TRANSCODER,
      inject: [ConfigService, MediaStorage],
      useFactory: (config: ConfigService, storage: MediaStorage) =>
        config.get<string>('VIDEO_TRANSCODER') === 'ffmpeg'
          ? new FfmpegVideoTranscoder(storage, config.get<string>('FFMPEG_PATH') || 'ffmpeg')
          : new MockVideoTranscoder(),
    },
  ],
})
export class EpisodePackageModule {}
