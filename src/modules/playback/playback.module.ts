import { Module } from '@nestjs/common';
import { StreamingSessionModule } from './streaming-session/streaming-session.module';

/** Main Flow 3 (playback & viewing experience); later phases add heartbeat, ads and progress here. */
@Module({
  imports: [StreamingSessionModule],
  exports: [StreamingSessionModule],
})
export class PlaybackModule {}
