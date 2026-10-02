import { EmailStatus } from '@prisma/client';
import type { MailerService } from 'src/infrastructure/mailer/mailer.service';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { NotificationService } from 'src/modules/notification/notification.service';
import { EMAIL_TEMPLATE, EmailOutboxService } from './email-outbox.service';

type Handler = (data: { emailMessageId: string }) => Promise<void>;

describe('EmailOutboxService', () => {
  const prisma = { emailMessage: { findUnique: jest.fn(), update: jest.fn() } };
  const mailer = { send: jest.fn() };
  const storage = { read: jest.fn() };
  const notifications = { notify: jest.fn() };
  let handler: Handler;
  let onFailed: (data: { emailMessageId: string }, error: Error) => Promise<void>;
  const queue = {
    register: jest.fn((_name: string, h: Handler, options: { onFailed: typeof onFailed }) => {
      handler = h;
      onFailed = options.onFailed;
    }),
    add: jest.fn(),
  };
  const service = new EmailOutboxService(
    prisma as unknown as PrismaService,
    mailer as unknown as MailerService,
    storage as unknown as ObjectStorage,
    queue as unknown as JobQueue,
    notifications as unknown as NotificationService,
  );
  const stored = {
    id: 'e1',
    toEmail: 'studio@example.com',
    subject: 'Brief',
    status: EmailStatus.QUEUED,
    attachmentKeys: ['movies/m1/brief.pdf'],
    payload: {
      text: 'Hello studio',
      attachments: [{ fileName: 'brief.pdf', contentType: 'application/pdf' }],
      notifyOnFailureId: 'creator-1',
      link: '/projects/m1',
    },
  };

  beforeAll(() => service.onModuleInit());
  beforeEach(() => jest.clearAllMocks());

  it('stores the message in the caller transaction with its private attachments', async () => {
    const tx = { emailMessage: { create: jest.fn().mockResolvedValue({ id: 'e1' }) } };
    const id = await service.create(tx as never, {
      to: 'studio@example.com',
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      subject: 'Brief',
      text: 'Hello studio',
      attachments: [{ key: 'movies/m1/brief.pdf', fileName: 'brief.pdf', contentType: 'application/pdf' }],
      notifyOnFailureId: 'creator-1',
    });
    expect(id).toBe('e1');
    expect(tx.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ attachmentKeys: ['movies/m1/brief.pdf'] }) }),
    );
  });

  it('delivers once per message id', async () => {
    await service.dispatch('e1');
    expect(queue.add).toHaveBeenCalledWith('email.send', { emailMessageId: 'e1' }, 'e1');
  });

  it('sends with the attachments read from private storage and marks the message SENT', async () => {
    prisma.emailMessage.findUnique.mockResolvedValue(stored);
    storage.read.mockResolvedValue(Buffer.from('%PDF'));

    await handler({ emailMessageId: 'e1' });

    expect(storage.read).toHaveBeenCalledWith('movies/m1/brief.pdf', 'private');
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'studio@example.com',
        attachments: [expect.objectContaining({ filename: 'brief.pdf' })],
      }),
    );
    expect(prisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: EmailStatus.SENT }) }),
    );
  });

  it('does not send a message twice', async () => {
    prisma.emailMessage.findUnique.mockResolvedValue({ ...stored, status: EmailStatus.SENT });
    await handler({ emailMessageId: 'e1' });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('records a failed attempt and lets the queue retry', async () => {
    prisma.emailMessage.findUnique.mockResolvedValue(stored);
    storage.read.mockResolvedValue(Buffer.from('%PDF'));
    mailer.send.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(handler({ emailMessageId: 'e1' })).rejects.toThrow('SMTP down');
    expect(prisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorMessage: 'Error: SMTP down' }) }),
    );
  });

  it('marks the message FAILED and tells the sender once retries are exhausted', async () => {
    prisma.emailMessage.update.mockResolvedValue(stored);
    await onFailed({ emailMessageId: 'e1' }, new Error('SMTP down'));
    expect(notifications.notify).toHaveBeenCalledWith(['creator-1'], expect.objectContaining({ link: '/projects/m1' }));
  });
});
