import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CountingDeviceEligibilityService, DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { PlaybackUrlService } from './playback-url.service';
import { StreamingSessionController } from './streaming-session.controller';
import { StreamingSessionService } from './streaming-session.service';

/** Phase 2 of Main Flow 3: session creation plus signed playlists and rendition filtering. */
@Module({
  imports: [PlatformSettingModule],
  controllers: [StreamingSessionController],
  providers: [
    PlaybackAccessService,
    { provide: DeviceEligibilityPort, useClass: CountingDeviceEligibilityService },
    PlaybackUrlService,
    StreamingSessionService,
  ],
  exports: [PlaybackAccessService, PlaybackUrlService, StreamingSessionService],
})
export class StreamingSessionModule {}
