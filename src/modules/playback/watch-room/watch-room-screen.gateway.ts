import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ROOM_CHANNEL, ROOM_EVENT } from './room-events';
import { isChatRejection, RoomSharedScreen } from './room-shared-screen';

interface SocketData {
  userId?: string;
}

/**
 * The shared screen of a watch room (BR-69, 13/11/2026), on the same `/watch` namespace as
 * WatchRoomGateway, which authenticates the socket and puts the member id in `client.data`.
 * - Ads: only the Host is served the mid-roll; the room sees the same ad and waits for the Host to skip it.
 * - Quality: the Host picks the rendition, every member's player follows.
 * - Chat: members still in the room talk beside the player (in memory, 50 latest lines).
 */
@WebSocketGateway({ namespace: 'watch', cors: { origin: '*', credentials: true }, transports: ['websocket'] })
export class WatchRoomScreenGateway {
  @WebSocketServer() server!: Server;
  readonly screen = new RoomSharedScreen();

  constructor(private readonly prisma: PrismaService) {}

  /** A member who just joined catches up: quality, the running ad and the chat so far. */
  @SubscribeMessage(ROOM_EVENT.SCREEN_STATE)
  async onScreenState(@ConnectedSocket() client: Socket, @MessageBody() body: { roomId: string }): Promise<void> {
    if (!(await this.seated(client, body?.roomId))) return;
    client.emit(ROOM_EVENT.SCREEN, this.screen.snapshot(body.roomId));
  }

  @SubscribeMessage(ROOM_EVENT.CHAT)
  async onChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; text: string },
  ): Promise<void> {
    const member = await this.seated(client, body?.roomId);
    if (!member) return;
    const result = this.screen.chat(body.roomId, member, body.text);
    if (isChatRejection(result)) return void client.emit(ROOM_EVENT.CHAT_REJECTED, { reason: result });
    this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.CHAT_MESSAGE, result);
  }

  /**
   * The Host's ad started or ended. The ad comes from the Host's own streaming session (never from the
   * client), so a Host cannot push an arbitrary video to the room.
   */
  @SubscribeMessage(ROOM_EVENT.AD_BREAK)
  async onAdBreak(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; active: boolean; breakId?: string },
  ): Promise<void> {
    if (!(await this.isHost(client, body?.roomId))) return;
    const userId = (client.data as SocketData).userId!;
    let ad = { active: false } as Parameters<RoomSharedScreen['setAd']>[1];
    if (body.active && body.breakId) {
      const row = await this.prisma.sessionAdBreak.findFirst({
        where: { id: body.breakId, session: { userId } },
        select: { ad: { select: { title: true, mediaUrl: true, durationSeconds: true } } },
      });
      if (!row) return void client.emit(ROOM_EVENT.ERROR, { reason: 'AD_BREAK_NOT_FOUND' });
      ad = { active: true, ...row.ad };
    }
    this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.AD_STATE, this.screen.setAd(body.roomId, ad));
  }

  @SubscribeMessage(ROOM_EVENT.QUALITY)
  async onQuality(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId: string; quality: string },
  ): Promise<void> {
    if (!(await this.isHost(client, body?.roomId))) return;
    const quality = this.screen.setQuality(body.roomId, body.quality);
    if (!quality) return void client.emit(ROOM_EVENT.ERROR, { reason: 'INVALID_QUALITY' });
    this.server.to(ROOM_CHANNEL(body.roomId)).emit(ROOM_EVENT.QUALITY_CHANGED, { quality });
  }

  /** The caller is still a participant of an open room; answers the chat author. */
  private async seated(client: Socket, roomId: string | undefined) {
    const userId = (client.data as SocketData).userId;
    if (!userId || typeof roomId !== 'string') return null;
    const row = await this.prisma.roomParticipant.findFirst({
      where: { roomId, userId, leftAt: null, room: { status: { not: 'DISBANDED' } } },
      select: { participant: { select: { fullName: true } } },
    });
    if (!row) {
      client.emit(ROOM_EVENT.ERROR, { reason: 'NOT_IN_ROOM' });
      return null;
    }
    return { userId, fullName: row.participant.fullName };
  }

  private async isHost(client: Socket, roomId: string | undefined): Promise<boolean> {
    const userId = (client.data as SocketData).userId;
    if (!userId || typeof roomId !== 'string') return false;
    const room = await this.prisma.watchRoom.findUnique({ where: { id: roomId }, select: { hostUserId: true } });
    if (room?.hostUserId === userId) return true;
    client.emit(ROOM_EVENT.ERROR, { reason: 'NOT_HOST' });
    return false;
  }
}
