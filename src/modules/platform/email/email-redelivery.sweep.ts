import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { EMAIL_TEMPLATE, EmailOutboxService } from './email-outbox.service';

const BATCH = 100;
/** Longer than the send job's own retries (5 tries from 30 s, doubling), so a live job is never doubled. */
export const STUCK_AFTER_MS = 30 * 60_000;

/**
 * `email-redelivery.sweep`: the outbox row commits with the change that causes it, but the send job
 * is queued afterwards; if Redis was down at that moment the row stays QUEUED with no job behind it.
 * This puts such rows back on the queue (the job id is the row id, so a job that does exist is not
 * doubled). A password-reset code is left alone: it is dead after 10 minutes and the member asks again.
 */
@Injectable()
export class EmailRedeliverySweep implements OnModuleInit {
  private readonly logger = new Logger(EmailRedeliverySweep.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly outbox: EmailOutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('email-redelivery.sweep', this.config.schedules.emailRedeliverySweepMs, () =>
      this.redeliverStuck().then(() => undefined),
    );
  }

  /** Queues every message stuck in QUEUED; returns how many were queued again. */
  async redeliverStuck(now = new Date()): Promise<number> {
    const stuck = await this.prisma.emailMessage.findMany({
      where: {
        status: EmailStatus.QUEUED,
        createdAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) },
        template: { not: EMAIL_TEMPLATE.PASSWORD_RESET_OTP },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    let queued = 0;
    for (const { id } of stuck) {
      try {
        await this.outbox.dispatch(id);
        queued += 1;
      } catch (error) {
        this.logger.warn(`Could not queue email ${id} again: ${String(error)}`);
      }
    }
    if (queued) this.logger.log(`Queued ${queued} stuck email(s) again`);
    return queued;
  }
}
