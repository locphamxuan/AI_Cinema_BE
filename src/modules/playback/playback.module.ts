import { Module } from '@nestjs/common';
import { AccessDecisionModule } from 'src/modules/episode-access/access-decision/access-decision.module';
import { RecommendationController } from './recommendation/recommendation.controller';
import { RecommendationService } from './recommendation/recommendation.service';
import { WatchRoomController } from './watch-room/watch-room.controller';
import { WatchRoomGateway } from './watch-room/watch-room.gateway';
import { WatchRoomService } from './watch-room/watch-room.service';

/** Main Flow 3 (playback & viewing experience) and Main Flow 4 (devices & concurrent streams). */
@Module({
  imports: [AccessDecisionModule],
  controllers: [WatchRoomController, RecommendationController],
  providers: [WatchRoomService, WatchRoomGateway, RecommendationService],
  exports: [WatchRoomService, RecommendationService],
})
export class PlaybackModule {}