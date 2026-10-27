import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { DeviceModule } from '../device/device.module';
import { PlaybackAccessModule } from '../playback-access/playback-access.module';
import { WatchProgressModule } from '../watch-progress/watch-progress.module';
import { AdBreakModule } from '../ad-break/ad-break.module';
import { PlaybackUrlService } from './playback-url.service';
import { SessionExpirySweep } from './session-expiry.sweep';
import { SessionRetentionSweep } from './session-retention.sweep';
import { StreamingSessionController } from './streaming-session.controller';
import { StreamingSessionService } from './streaming-session.service';

/** Phase 5 of Main Flow 3: sessions, progress, ads and the expiry sweep. */
@Module({
  imports: [
    AuditLogModule,
    PlatformSettingModule,
    PlaybackAccessModule,
    DeviceModule,
    WatchProgressModule,
    AdBreakModule,
  ],
  controllers: [StreamingSessionController],
  providers: [PlaybackUrlService, StreamingSessionService, SessionExpirySweep, SessionRetentionSweep],
  exports: [PlaybackAccessModule, PlaybackUrlService, StreamingSessionService],
})
export class StreamingSessionModule {}
