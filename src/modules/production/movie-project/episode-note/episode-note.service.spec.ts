import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EpisodeNoteService } from './episode-note.service';

const user = (id: string) => ({ id }) as never;

function setup(assignedCreatorId: string | null, status = 'IN_PRODUCTION') {
  const episode = { id: 'e1', episodeNumber: 2, assignedCreatorId, project: { id: 'p1', creatorId: 'lead', status } };
  const access = { episode: jest.fn().mockResolvedValue(episode) };
  const rows = [
    {
      id: 'n1',
      payload: { message: 'Tập 2 lệch kịch bản', toLead: true },
      createdAt: new Date('2026-11-01T00:00:00Z'),
      actor: { id: 'helper', fullName: 'Creator Phụ' },
    },
  ];
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue(rows) },
    $transaction: jest.fn((run: (tx: unknown) => Promise<unknown>) => run({})),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new EpisodeNoteService(prisma as never, access as never, auditLog as never, notifications as never);
  return { service, access, auditLog, notifications };
}

describe('EpisodeNoteService (BR-67)', () => {
  it('sends the note of the co-Creator holding the episode to the lead', async () => {
    const { service, auditLog, notifications } = setup('helper');
    const notes = await service.send('e1', '  Tập 2 lệch kịch bản  ', user('helper'));

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EPISODE_NOTE_SENT',
        entityId: 'e1',
        actorId: 'helper',
        payload: { message: 'Tập 2 lệch kịch bản', toLead: true },
      }),
      {},
    );
    expect(notifications.notify).toHaveBeenCalledWith(['lead'], expect.objectContaining({ type: 'EPISODE_NOTE' }), {});
    expect(notes).toEqual([
      expect.objectContaining({ message: 'Tập 2 lệch kịch bản', author: { id: 'helper', fullName: 'Creator Phụ' } }),
    ]);
  });

  it('lets the lead answer the co-Creator', async () => {
    const { service, notifications } = setup('helper');
    await service.send('e1', 'Đã báo Studio', user('lead'));
    expect(notifications.notify).toHaveBeenCalledWith(['helper'], expect.anything(), {});
  });

  it('needs the episode to be given to a co-Creator first', async () => {
    for (const holder of [null, 'lead']) {
      const { service } = setup(holder);
      await expect(service.send('e1', 'x', user('lead'))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('keeps other Creators of the team out of the exchange', async () => {
    const { service } = setup('helper');
    await expect(service.send('e1', 'x', user('other'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a blank note and a project that is closed', async () => {
    await expect(setup('helper').service.send('e1', '   ', user('helper'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup('helper', 'COMPLETED').service.send('e1', 'x', user('helper'))).rejects.toThrow();
  });

  it('shows the notes to anyone who may read the project', async () => {
    const { service, access } = setup('helper');
    await service.list('e1', user('rev'));
    expect(access.episode).toHaveBeenCalledWith('e1', expect.anything(), 'read');
  });
});
