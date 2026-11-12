import { Injectable, Logger } from '@nestjs/common';
import { WatchRoomService } from './watch-room.service';
import { ROOM_TERMINATED_REASON } from './room-events';

/** How the gateway hears about rooms the catalog force-closed; it registers itself on boot. */
export type RoomTerminationSink = (roomIds: string[], reason: string) => void;

/**
 * Edge 1.4 — a takedown (BR-52/BR-56) reaches the watch rooms: Publishing calls this when an
 * episode is unpublished, every open room on that episode is closed in the database, and the
 * gateway broadcasts ROOM_TERMINATED so every player stops at once. The Coin refunds of BR-52
 * stay where they are (EntitlementService); this only stops the shared playback.
 */
@Injectable()
export class RoomTerminationService {
  private readonly logger = new Logger(RoomTerminationService.name);
  private sink: RoomTerminationSink | null = null;

  constructor(private readonly rooms: WatchRoomService) {}

  /** The gateway hands over its broadcast once it is alive. */
  register(sink: RoomTerminationSink): void {
    this.sink = sink;
  }

  /** Close every open room of this episode and tell the members why. */
  async episodeTakenDown(episodeId: string): Promise<void> {
    const roomIds = await this.rooms.terminateByEpisode(episodeId);
    if (!roomIds.length) return;
    this.logger.log(`Episode ${episodeId} taken down; ${roomIds.length} watch room(s) terminated`);
    this.sink?.(roomIds, ROOM_TERMINATED_REASON.EPISODE_TAKEN_DOWN);
  }
}
