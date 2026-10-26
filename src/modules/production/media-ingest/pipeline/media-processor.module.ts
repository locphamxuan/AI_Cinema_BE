import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { FfmpegMediaProcessor, MediaProcessor, MockMediaProcessor } from './media-processor';

/** FFmpeg (or its test stand-in): shared by episode ingest and by ad videos, whose length it reads. */
@Module({
  providers: [
    {
      provide: MediaProcessor,
      inject: [APP_CONFIG],
      useFactory: ({ media }: AppConfig): MediaProcessor =>
        media.pipeline === 'ffmpeg'
          ? new FfmpegMediaProcessor(media.ffmpegPath, media.ffprobePath)
          : new MockMediaProcessor(),
    },
  ],
  exports: [MediaProcessor],
})
export class MediaProcessorModule {}
