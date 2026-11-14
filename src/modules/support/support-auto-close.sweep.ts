import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupportCloseReason, SupportSenderType, SupportStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { SupportConversationService } from './chat/support-conversation.service';

const SWEEP_NAME = 'support.auto-close.sweep';
const BATCH = 200;

/**
 * Plan §7/§11.4: only a case where the AI already suggested a resolution and the member has not
 * written since is closed for inactivity. A case the AI never resolved is left for Staff, and a
 * member reply after the suggestion restarts the clock.
 */
@Injectable()
export class SupportAutoCloseSweep implements OnModuleInit {
  private readonly logger = new Logger(SupportAutoCloseSweep.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly conversations: SupportConversationService,
    private readonly queue: JobQueue,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.queue.every(SWEEP_NAME, this.config.support.autoCloseSweepMs, () => this.run().then(() => undefined));
  }

  async run(): Promise<{ closed: number }> {
    const cutoff = new Date(Date.now() - this.config.support.autoCloseHours * 60 * 60_000);
    const candidates = await this.prisma.supportConversation.findMany({
      where: {
        status: SupportStatus.AI_HANDLING,
        aiResolutionSuggestedAt: { not: null, lt: cutoff },
        // A member who answered after the suggestion keeps the case open; filtered here, not after the
        // query, so 200 such cases first in line can never fill the batch and starve the others.
        OR: [
          { lastMemberMessageAt: null },
          { lastMemberMessageAt: { lte: this.prisma.supportConversation.fields.aiResolutionSuggestedAt } },
        ],
      },
      orderBy: { aiResolutionSuggestedAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        memberId: true,
        aiResolutionSuggestedAt: true,
        resolvedAt: true,
        lastMemberMessageAt: true,
      },
    });

    let closed = 0;
    for (const candidate of candidates) {
      const suggestedAt = candidate.aiResolutionSuggestedAt;
      if (!suggestedAt) continue;
      if (candidate.lastMemberMessageAt && candidate.lastMemberMessageAt > suggestedAt) continue;

      try {
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
          await this.conversations.transition(
            candidate.id,
            SupportStatus.AI_HANDLING,
            SupportStatus.CLOSED,
            {
              closedAt: now,
              resolvedAt: candidate.resolvedAt ?? suggestedAt,
              closeReason: SupportCloseReason.INACTIVITY,
            },
            tx,
          );

          await tx.supportMessage.create({
            data: {
              conversationId: candidate.id,
              senderType: SupportSenderType.SYSTEM,
              senderId: null,
              content:
                'Yêu cầu hỗ trợ đã được tự động đóng vì không có phản hồi sau khi trợ lý AI đề xuất cách giải quyết. Bạn có thể mở yêu cầu mới nếu vẫn cần hỗ trợ.',
              isInternal: false,
            },
          });

          await this.audit.record(
            {
              action: CONTENT_EVENT.SUPPORT_CASE_CLOSED,
              entityType: 'SupportConversation',
              entityId: candidate.id,
              projectId: null,
              actorId: null,
              payload: { closeReason: SupportCloseReason.INACTIVITY, automatic: true },
            },
            tx,
          );
        });
      } catch (error) {
        // A concurrent member reply or Staff claim wins the guarded transition; skip this case.
        this.logger.warn(`Auto-close skipped conversation ${candidate.id}: ${errorMessage(error)}`);
        continue;
      }
      closed += 1;
      try {
        await this.notifications.notify([candidate.memberId], {
          type: NOTIFICATION_TYPE.SUPPORT_CASE_CLOSED,
          title: 'Yêu cầu hỗ trợ đã tự động đóng',
          body: 'Không có phản hồi sau khi trợ lý AI đề xuất cách giải quyết. Bạn có thể mở yêu cầu hỗ trợ mới.',
          link: `/support/conversations/${candidate.id}`,
          payload: { conversationId: candidate.id, closeReason: SupportCloseReason.INACTIVITY },
        });
      } catch (error) {
        // The case is closed already; only the notice failed.
        this.logger.warn(`Closed conversation ${candidate.id} but could not notify the member: ${errorMessage(error)}`);
      }
    }

    if (closed) this.logger.log(`Auto-closed ${closed} inactive support case(s)`);
    return { closed };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
