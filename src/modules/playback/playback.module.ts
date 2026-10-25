import { Module } from '@nestjs/common';
import { AdBreakModule } from './ad-break/ad-break.module';
import { StreamingSessionModule } from './streaming-session/streaming-session.module';
import { WatchProgressModule } from './watch-progress/watch-progress.module';

/** Main Flow 3 (playback & viewing experience); the next phase adds the expiry sweep here. */
@Module({
  imports: [StreamingSessionModule, WatchProgressModule, AdBreakModule],
  exports: [StreamingSessionModule, WatchProgressModule, AdBreakModule],
})
export class PlaybackModule {}
