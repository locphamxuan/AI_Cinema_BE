import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { DeviceEligibilityPort } from '../playback-access/device-eligibility.port';
import { PlaybackAccessModule } from '../playback-access/playback-access.module';
import { WatchProgressModule } from '../watch-progress/watch-progress.module';
import { DeviceController } from './device.controller';
import { DeviceEligibilityService } from './device-eligibility.service';
import { DeviceService } from './device.service';

/** Main Flow 4: device registration, plan device/stream limits and the member's device list. */
@Module({
  imports: [AuditLogModule, PlatformSettingModule, PlaybackAccessModule, WatchProgressModule],
  controllers: [DeviceController],
  providers: [DeviceService, { provide: DeviceEligibilityPort, useClass: DeviceEligibilityService }],
  exports: [DeviceEligibilityPort],
})
export class DeviceModule {}
