import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CountingDeviceEligibilityService, DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { WatchProgressModule } from '../watch-progress/watch-progress.module';
import { AdBreakModule } from '../ad-break/ad-break.module';
import { PlaybackUrlService } from './playback-url.service';
import { SessionExpirySweep } from './session-expiry.sweep';
import { StreamingSessionController } from './streaming-session.controller';
import { StreamingSessionService } from './streaming-session.service';

/** Phase 5 of Main Flow 3: sessions, progress, ads and the expiry sweep. */
@Module({
  imports: [PlatformSettingModule, WatchProgressModule, AdBreakModule],
  controllers: [StreamingSessionController],
  providers: [
    PlaybackAccessService,
    { provide: DeviceEligibilityPort, useClass: CountingDeviceEligibilityService },
    PlaybackUrlService,
    StreamingSessionService,
    SessionExpirySweep,
  ],
  exports: [PlaybackAccessService, PlaybackUrlService, StreamingSessionService],
})
export class StreamingSessionModule {}
