import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { HlsLinkCheckJob } from './hls-link-check.job';
import { MediaIngestController } from './media-ingest.controller';
import { MediaIngestService } from './media-ingest.service';
import { MediaOutcomeService } from './media-outcome.service';
import { MediaPipelineService } from './media-pipeline.service';
import { FfmpegMediaProcessor, MediaProcessor, MockMediaProcessor } from './media-processor';

@Module({
  imports: [
    // Episode videos are far too large for memory: multer writes them to a temporary file.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: ({ media }: AppConfig) => ({
        dest: join(tmpdir(), 'ai-cinema-uploads'),
        limits: { fileSize: media.maxUploadBytes, files: 1 },
      }),
    }),
  ],
  controllers: [MediaIngestController],
  providers: [
    MediaIngestService,
    MediaPipelineService,
    MediaOutcomeService,
    HlsLinkCheckJob,
    {
      provide: MediaProcessor,
      inject: [APP_CONFIG],
      useFactory: ({ media }: AppConfig): MediaProcessor =>
        media.pipeline === 'ffmpeg'
          ? new FfmpegMediaProcessor(media.ffmpegPath, media.ffprobePath)
          : new MockMediaProcessor(),
    },
  ],
})
export class MediaIngestModule {}
