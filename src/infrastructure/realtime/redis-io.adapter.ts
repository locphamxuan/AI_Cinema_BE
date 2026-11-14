import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.io over Redis pub/sub: a broadcast to a room channel reaches the sockets of every API
 * instance, `fetchSockets()` sees them all and `serverSideEmit()` lets instances share the watch room
 * state (see RoomCluster). Without it each instance only knows its own sockets.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RedisIoAdapter.name);
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: INestApplicationContext, redisUrl: string) {
    super(app);
    this.pub = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.sub = this.pub.duplicate();
    for (const client of [this.pub, this.sub]) {
      client.on('error', (error: Error) => this.redisLogger.warn(`Socket Redis: ${error.message}`));
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    // @nestjs/platform-socket.io bundles its own socket.io copy, typed `any` here.
    const server = super.createIOServer(port, options) as unknown as Server;
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await super.close(server);
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
