import { Module } from '@nestjs/common';
import { PlatformSettingController } from './platform-setting.controller';
import { PlatformSettingService } from './platform-setting.service';

@Module({
  controllers: [PlatformSettingController],
  providers: [PlatformSettingService],
  exports: [PlatformSettingService],
})
export class PlatformSettingModule {}
