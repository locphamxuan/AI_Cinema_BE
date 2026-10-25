import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Display name shown instead of the platform's; the address stays the SMTP account's (Gmail rewrites others). */
  fromName?: string;
  /** Where the recipient's reply goes, e.g. the Creator who sent the brief. */
  replyTo?: string;
}

/** The bare address of a `Name <address>` string. */
function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from;
}

/** SMTP sender (Mailtrap during development). Without SMTP_HOST mails are only logged. */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly delivers: boolean;

  constructor(@Inject(APP_CONFIG) { mail }: AppConfig) {
    this.from = mail.from;
    this.delivers = mail.host !== null;
    this.transport = mail.host
      ? createTransport({
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
        })
      : createTransport({ jsonTransport: true });
  }

  async send({ fromName, ...mail }: OutgoingMail): Promise<void> {
    const from = fromName ? { name: fromName, address: addressOf(this.from) } : this.from;
    await this.transport.sendMail({ from, ...mail });
    if (!this.delivers) {
      this.logger.log(`SMTP is not configured; "${mail.subject}" to ${mail.to} was not delivered`);
    }
  }
}
