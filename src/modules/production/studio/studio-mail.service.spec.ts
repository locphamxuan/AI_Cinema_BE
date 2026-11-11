import { StudioMailService } from './studio-mail.service';

function setup() {
  const tx = {
    studio: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Lumen', email: 'lumen@studio.vn' }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ fullName: 'Lan Admin', email: 'lan@gmail.com' }) },
  };
  const outbox = { create: jest.fn().mockResolvedValue('m1'), dispatch: jest.fn().mockResolvedValue(undefined) };
  const service = new StudioMailService(outbox as never, { studioWebUrl: 'https://studio.example/' } as never);
  return { service, tx, outbox };
}

const MAIL = {
  studioId: 's1',
  senderId: 'admin',
  subject: '[AI Cinema] Hợp đồng',
  lines: ['Mời báo giá.'],
  portalPath: '/contracts',
  failureLink: '/projects/p1/contract',
};

describe('StudioMailService', () => {
  it('sends under the name of the person in charge, who gets the reply', async () => {
    const { service, tx, outbox } = setup();
    await expect(service.queue(tx as never, MAIL)).resolves.toBe('m1');
    expect(outbox.create).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        to: 'lumen@studio.vn',
        fromName: 'Lan Admin - AI Cinema',
        replyTo: 'lan@gmail.com',
        notifyOnFailureId: 'admin',
      }),
    );
  });

  it('only links to the Studio Web: nothing is attached', async () => {
    const { service, tx, outbox } = setup();
    await service.queue(tx as never, MAIL);
    const [, email] = outbox.create.mock.calls[0] as [unknown, { text: string; attachments: unknown[] }];
    expect(email.attachments).toEqual([]);
    expect(email.text).toContain('https://studio.example/contracts');
    expect(email.text).toContain('Đầu mối: Lan Admin - lan@gmail.com');
  });

  it('sends nothing for a project without a studio', async () => {
    const { service, tx, outbox } = setup();
    await expect(service.queue(tx as never, { ...MAIL, studioId: null })).resolves.toBeNull();
    expect(outbox.create).not.toHaveBeenCalled();
  });

  it('dispatches what was queued, and a queue outage never fails the committed change', async () => {
    const { service, outbox } = setup();
    outbox.dispatch.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.dispatch('m1', null, 'm2')).resolves.toBeUndefined();
    expect(outbox.dispatch.mock.calls).toEqual([['m1'], ['m2']]);
  });
});
