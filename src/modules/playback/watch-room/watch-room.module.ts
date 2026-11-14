import { Module } from '@nestjs/common';
import { AccessDecisionModule } from 'src/modules/episode-access/access-decision/access-decision.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { PlaybackAccessModule } from '../playback-access/playback-access.module';
import { RoomCluster } from './room-cluster';
import { RoomInviteService } from './room-invite.service';
import { RoomJoinGuard } from './room-join.guard';
import { RoomTerminationService } from './room-termination.service';
import { WatchRoomController } from './watch-room.controller';
import { WatchRoomScreenGateway } from './watch-room-screen.gateway';
import { WatchRoomGateway } from './watch-room.gateway';
import { WatchRoomService } from './watch-room.service';

/**
 * Watch Party (BR-69, MF-3/MF-4): rooms, the Host-driven sync gateway and the door checks of the
 * 2026-11-11 edge-case review. Publishing imports this to terminate rooms on a takedown (edge 1.4).
 */
@Module({
  imports: [AccessDecisionModule, PlaybackAccessModule, PlatformSettingModule, NotificationModule],
  controllers: [WatchRoomController],
  providers: [
    WatchRoomService,
    WatchRoomGateway,
    WatchRoomScreenGateway,
    RoomJoinGuard,
    RoomTerminationService,
    RoomInviteService,
    RoomCluster,
  ],
  exports: [WatchRoomService, RoomTerminationService],
})
export class WatchRoomModule {}
