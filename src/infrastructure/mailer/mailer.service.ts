import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
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

  async send(mail: OutgoingMail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
    if (!this.delivers) {
      this.logger.log(`SMTP is not configured; "${mail.subject}" to ${mail.to} was not delivered`);
    }
  }
}
