import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';

const DISPATCH_INTERVAL_MS = 500;
const DISPATCH_BATCH_SIZE = 100;

/** Publishes committed outbox rows; a row is removed only after its socket event has been emitted. */
@Injectable()
export class NotificationRealtimeDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRealtimeDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationRealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.dispatchPending().catch((error: unknown) =>
        this.logger.error(`Could not dispatch notification events: ${String(error)}`),
      );
    }, DISPATCH_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.prisma.notificationRealtimeEvent.findMany({
        select: { id: true, userId: true },
        orderBy: { createdAt: 'asc' },
        take: DISPATCH_BATCH_SIZE,
      });
      if (!pending.length) return;

      for (const event of pending) {
        if (!this.gateway.publishChanged(event.userId)) return;
      }
      await this.prisma.notificationRealtimeEvent.deleteMany({
        where: { id: { in: pending.map(({ id }) => id) } },
      });
    } finally {
      this.running = false;
    }
  }
}
