import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { PlaybackAccessService } from './playback-access.service';

/** Main Flow 3, steps 2-4: the access re-check and the plan reads playback and MF-4 share. */
@Module({
  imports: [PlatformSettingModule],
  providers: [PlaybackAccessService],
  exports: [PlaybackAccessService],
})
export class PlaybackAccessModule {}
