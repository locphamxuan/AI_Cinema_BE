import { Injectable, OnModuleInit } from '@nestjs/common';
import { EmailStatus, Prisma } from '@prisma/client';
import { MailerService } from 'src/infrastructure/mailer/mailer.service';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { NotificationService } from 'src/modules/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/notification/notification-types';

export const EMAIL_TEMPLATE = { STUDIO_BRIEF: 'STUDIO_BRIEF' } as const;

export interface EmailAttachment {
  /** Private storage key of the file. */
  key: string;
  fileName: string;
  contentType: string;
}

export interface NewEmail {
  to: string;
  template: (typeof EMAIL_TEMPLATE)[keyof typeof EMAIL_TEMPLATE];
  subject: string;
  text: string;
  attachments: EmailAttachment[];
  /** Account told in-app when the email could not be delivered. */
  notifyOnFailureId: string;
  /** Screen the failure notification opens. */
  link?: string;
}

interface StoredPayload {
  text: string;
  attachments: Omit<EmailAttachment, 'key'>[];
  notifyOnFailureId: string;
  link?: string;
}

const SEND_JOB = 'email.send';

/**
 * Outbox of the only emails the platform sends (BR-53). The message is written with the
 * change that causes it, then delivered by a background job with retries; a message that
 * still fails is marked FAILED and its sender is notified in-app.
 */
@Injectable()
export class EmailOutboxService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly storage: ObjectStorage,
    private readonly queue: JobQueue,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.queue.register<{ emailMessageId: string }>(SEND_JOB, ({ emailMessageId }) => this.deliver(emailMessageId), {
      attempts: 5,
      backoffMs: 30_000,
      onFailed: ({ emailMessageId }, error) => this.giveUp(emailMessageId, error),
    });
  }

  /** Writes the message inside the caller's transaction; call dispatch() once it committed. */
  async create(tx: PrismaTx, email: NewEmail): Promise<string> {
    const payload: StoredPayload = {
      text: email.text,
      attachments: email.attachments.map(({ fileName, contentType }) => ({ fileName, contentType })),
      notifyOnFailureId: email.notifyOnFailureId,
      link: email.link,
    };
    const message = await tx.emailMessage.create({
      data: {
        toEmail: email.to,
        template: email.template,
        subject: email.subject,
        payload: payload as unknown as Prisma.InputJsonValue,
        attachmentKeys: email.attachments.map(({ key }) => key),
      },
      select: { id: true },
    });
    return message.id;
  }

  dispatch(emailMessageId: string): Promise<void> {
    return this.queue.add(SEND_JOB, { emailMessageId }, emailMessageId);
  }

  private async deliver(emailMessageId: string): Promise<void> {
    const message = await this.prisma.emailMessage.findUnique({ where: { id: emailMessageId } });
    if (!message || message.status === EmailStatus.SENT) return;
    const payload = message.payload as unknown as StoredPayload;
    try {
      const attachments = await Promise.all(
        message.attachmentKeys.map(async (key, i) => ({
          filename: payload.attachments[i]?.fileName ?? key.split('/').pop() ?? 'attachment',
          contentType: payload.attachments[i]?.contentType,
          content: await this.storage.read(key, 'private'),
        })),
      );
      await this.mailer.send({ to: message.toEmail, subject: message.subject, text: payload.text, attachments });
      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: EmailStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, errorMessage: null },
      });
    } catch (error) {
      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { attempts: { increment: 1 }, errorMessage: String(error) },
      });
      throw error;
    }
  }

  private async giveUp(emailMessageId: string, error: Error): Promise<void> {
    const message = await this.prisma.emailMessage.update({
      where: { id: emailMessageId },
      data: { status: EmailStatus.FAILED, errorMessage: error.message },
    });
    const payload = message.payload as unknown as StoredPayload;
    await this.notifications.notify([payload.notifyOnFailureId], {
      type: NOTIFICATION_TYPE.BRIEF_EMAIL_FAILED,
      title: `Email "${message.subject}" to ${message.toEmail} could not be delivered`,
      body: error.message,
      link: payload.link,
      payload: { emailMessageId },
    });
  }
}
