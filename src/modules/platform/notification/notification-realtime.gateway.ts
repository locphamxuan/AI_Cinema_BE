import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayInit, WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { memberOfToken, socketAuth } from 'src/common/realtime/member-socket-auth';
import { NOTIFICATION_UPDATED_EVENT, NOTIFICATION_USER_CHANNEL } from './notification-events';

@WebSocketGateway({ namespace: 'notifications', cors: { origin: '*', credentials: true }, transports: ['websocket'] })
export class NotificationRealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(server: Namespace): void {
    server.use(socketAuth((token) => this.memberOf(token)));
  }

  handleConnection(client: Socket): void {
    const userId = (client.data as { userId?: string }).userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    void client.join(NOTIFICATION_USER_CHANNEL(userId));
  }

  /** Broadcasts an invalidation only; each app reads its own notification rows from the API. */
  publishChanged(userId: string): boolean {
    if (!this.server) return false;
    this.server.to(NOTIFICATION_USER_CHANNEL(userId)).emit(NOTIFICATION_UPDATED_EVENT, { updatedAt: Date.now() });
    return true;
  }

  private memberOf(token: string): Promise<string> {
    return memberOfToken(this.jwt, this.config.jwt, this.prisma, token);
  }
}
