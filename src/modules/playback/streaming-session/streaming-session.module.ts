import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { CountingDeviceEligibilityService, DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessService } from '../playback-access/playback-access.service';
import { StreamingSessionController } from './streaming-session.controller';
import { StreamingSessionService } from './streaming-session.service';

/** Phase 1 of Main Flow 3: playback-access verification plus session creation. */
@Module({
  imports: [PlatformSettingModule],
  controllers: [StreamingSessionController],
  providers: [
    PlaybackAccessService,
    { provide: DeviceEligibilityPort, useClass: CountingDeviceEligibilityService },
    StreamingSessionService,
  ],
  exports: [PlaybackAccessService, StreamingSessionService],
})
export class StreamingSessionModule {}
