import { Module } from '@nestjs/common';
import { AdBreakModule } from './ad-break/ad-break.module';
import { DeviceModule } from './device/device.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { StreamingSessionModule } from './streaming-session/streaming-session.module';
import { WatchProgressModule } from './watch-progress/watch-progress.module';
import { WatchRoomModule } from './watch-room/watch-room.module';

/** Main Flow 3 (playback & viewing experience) and Main Flow 4 (devices & concurrent streams). */
@Module({
  imports: [
    StreamingSessionModule,
    DeviceModule,
    WatchProgressModule,
    AdBreakModule,
    RecommendationModule,
    WatchRoomModule,
  ],
  exports: [StreamingSessionModule, WatchProgressModule, AdBreakModule, WatchRoomModule],
})
export class PlaybackModule {}
