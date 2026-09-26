import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { PRODUCTION_EVENT } from 'src/modules/audit-log/production-events';
import { PublicationService } from './publication.service';

const DEFAULT_SWEEP_MS = 30_000;

/**
 * Schedule Film (MF-1 step 14): publishes every scheduled episode once its time comes.
 * It polls the database instead of holding timers, so a restart never loses a schedule
 * and several API instances can run it side by side. PUBLICATION_SWEEP_MS=0 turns it off
 * (it is always off under Jest).
 */
@Injectable()
export class PublicationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PublicationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly publications: PublicationService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(this.config.get<string>('PUBLICATION_SWEEP_MS') ?? DEFAULT_SWEEP_MS);
    if (process.env.NODE_ENV === 'test' || !(interval > 0)) return;
    this.timer = setInterval(() => void this.sweep(), interval);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Publishes what is due; returns how many episodes went live. */
  async sweep(now = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let published = 0;
    try {
      for (const { id } of await this.publications.findDue(now)) {
        if (!(await this.publications.goLive(id))) continue;
        published += 1;
        await this.auditLog.record({
          action: PRODUCTION_EVENT.EPISODE_PUBLISHED,
          entityType: 'Publication',
          entityId: id,
          actorId: null,
          payload: { scheduled: true },
        });
      }
    } catch (error) {
      this.logger.error(`Scheduled publishing failed: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
    if (published > 0) this.logger.log(`Published ${published} scheduled episode(s)`);
    return published;
  }
}
