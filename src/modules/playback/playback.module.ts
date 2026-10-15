import { Module } from '@nestjs/common';
import { StreamingSessionModule } from './streaming-session/streaming-session.module';
import { WatchProgressModule } from './watch-progress/watch-progress.module';

/** Main Flow 3 (playback & viewing experience); the next phase adds ads here. */
@Module({
  imports: [StreamingSessionModule, WatchProgressModule],
  exports: [StreamingSessionModule, WatchProgressModule],
})
export class PlaybackModule {}
