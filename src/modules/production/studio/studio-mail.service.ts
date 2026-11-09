import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import {
  EMAIL_TEMPLATE,
  EmailOutboxService,
  type EmailAttachment,
  type NewEmail,
} from 'src/modules/platform/email/email-outbox.service';

export interface StudioMail {
  /** No studio on the project yet: nothing is sent. */
  studioId: string | null;
  /** The Admin or Reviewer the studio talks to: named as the sender, and where its reply goes. */
  senderId: string;
  subject: string;
  lines: string[];
  /** Page of the Studio Web the studio acts on. */
  portalPath: string;
  /** Screen of the back office opened by the failure notification. */
  failureLink: string;
  /** STUDIO_UPDATE unless said otherwise (the brief of a studio change). */
  template?: NewEmail['template'];
  /** Only the brief PDF of a studio change: scripts and films never leave the platform by email. */
  attachments?: EmailAttachment[];
}

/**
 * MF-1 (08/11/2026): the Admin and the Reviewer talk to a studio by Gmail. Every message leaves the platform's one
 * mailbox under the name of the person in charge, and a reply reaches that person directly. A message only says what
 * happened and links to the Studio Web: the script and the films never leave the platform by email.
 */
@Injectable()
export class StudioMailService {
  private readonly logger = new Logger(StudioMailService.name);

  constructor(
    private readonly outbox: EmailOutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Writes the message inside the caller's transaction; call dispatch() once it committed. */
  async queue(tx: PrismaTx, mail: StudioMail): Promise<string | null> {
    if (!mail.studioId) return null;
    const studio = await tx.studio.findUniqueOrThrow({ where: { id: mail.studioId } });
    const sender = await tx.user.findUniqueOrThrow({
      where: { id: mail.senderId },
      select: { fullName: true, email: true },
    });
    const portal = `${this.config.studioWebUrl.replace(/\/+$/, '')}${mail.portalPath}`;
    return this.outbox.create(tx, {
      to: studio.email,
      template: mail.template ?? EMAIL_TEMPLATE.STUDIO_UPDATE,
      subject: mail.subject,
      text: [
        `Kính gửi ${studio.name},`,
        '',
        ...mail.lines,
        '',
        `Xem chi tiết và thao tác trên Studio Web: ${portal}`,
        '',
        `Đầu mối: ${sender.fullName} - ${sender.email}. Trả lời thư này để trao đổi trực tiếp.`,
      ].join('\n'),
      attachments: mail.attachments ?? [],
      notifyOnFailureId: mail.senderId,
      link: mail.failureLink,
      fromName: `${sender.fullName} - AI Cinema`,
      replyTo: sender.email,
    });
  }

  /** Sends what was queued. The change already committed, so a queue outage is logged and never undoes it. */
  async dispatch(...emailIds: (string | null)[]): Promise<void> {
    for (const id of emailIds) {
      if (!id) continue;
      await this.outbox.dispatch(id).catch((error: unknown) => {
        this.logger.error(`Could not queue studio email ${id}: ${String(error)}`);
      });
    }
  }
}
