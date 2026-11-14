import { Module } from '@nestjs/common';
import { WatchProgressController } from './watch-progress.controller';
import { WatchProgressService } from './watch-progress.service';

/** Phase 3 of Main Flow 3: saved positions, resume lookup and watch history. */
@Module({
  controllers: [WatchProgressController],
  providers: [WatchProgressService],
  exports: [WatchProgressService],
})
export class WatchProgressModule {}
