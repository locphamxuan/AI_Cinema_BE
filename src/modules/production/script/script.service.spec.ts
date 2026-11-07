import { ConflictException } from '@nestjs/common';
import { ProjectStatus, ScriptReviewStage, ScriptStatus } from '@prisma/client';
import { ScriptService } from './script.service';

const PROJECT = {
  id: 'p1',
  status: ProjectStatus.ASSIGNED,
  reviewerId: 'rev',
  creatorId: 'cre',
  studioId: 's1',
  movie: { title: 'Phim A' },
};

function setup(script: { status: ScriptStatus; currentVersion: number } | null) {
  const db = {
    projectScript: {
      findUnique: jest.fn().mockResolvedValue(script),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    scriptVersion: { create: jest.fn() },
    scriptReview: { create: jest.fn() },
    movieProject: { update: jest.fn() },
    episode: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0) },
    $queryRaw: jest.fn(),
  };
  const prisma = { ...db, $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)) };
  const access = { project: jest.fn().mockResolvedValue(PROJECT) };
  const contracts = { sendTemplate: jest.fn() };
  const studios = { assertUsable: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn().mockResolvedValue(['admin']) };
  const auditLog = { record: jest.fn() };
  const service = new ScriptService(
    prisma as never,
    access as never,
    contracts as never,
    studios as never,
    notifications as never,
    auditLog as never,
  );
  return { service, db, contracts, notifications };
}

const ADMIN = { id: 'admin', role: 'ADMIN' } as const;
const CREATOR = { id: 'cre', role: 'CONTENT_CREATOR' } as const;
const REVIEWER = { id: 'rev', role: 'CONTENT_REVIEWER' } as const;

describe('ScriptService (MF-1 §2)', () => {
  it('stores the first submission as version 1 and tells the Reviewer', async () => {
    const { service, db, notifications } = setup(null);
    await service.submit('p1', { content: 'CẢNH 1' }, CREATOR);
    expect(db.scriptVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', version: 1, content: 'CẢNH 1' }),
    });
    expect(notifications.notify).toHaveBeenCalledWith(['rev'], expect.anything(), db);
  });

  it('refuses a new version while the current one waits for its review', async () => {
    const { service } = setup({ status: ScriptStatus.SUBMITTED, currentVersion: 1 });
    await expect(service.submit('p1', { content: 'x' }, CREATOR)).rejects.toThrow(ConflictException);
  });

  it('passes an approved version on to the Admins', async () => {
    const { service, db, notifications } = setup({ status: ScriptStatus.SUBMITTED, currentVersion: 2 });
    await service.review('p1', { approve: true }, REVIEWER);
    expect(db.scriptReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 2, stage: ScriptReviewStage.REVIEWER, approved: true }),
    });
    expect(db.projectScript.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ScriptStatus.REVIEWER_APPROVED }) }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(['admin'], expect.anything(), db);
  });

  it('sends the studio its template contract once the Admin approves the Final Script', async () => {
    const { service, db, contracts } = setup({ status: ScriptStatus.REVIEWER_APPROVED, currentVersion: 2 });
    await service.finalReview('p1', { approve: true }, ADMIN);
    expect(db.projectScript.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ScriptStatus.FINAL }) }),
    );
    expect(contracts.sendTemplate).toHaveBeenCalledWith(db, 'p1', 'admin', undefined);
  });

  it('sends the Final Script straight back to the Creator without a contract', async () => {
    const { service, db, contracts, notifications } = setup({
      status: ScriptStatus.REVIEWER_APPROVED,
      currentVersion: 2,
    });
    await service.finalReview('p1', { approve: false, comment: 'Đổi kết' }, ADMIN);
    expect(db.projectScript.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ScriptStatus.REVISION_REQUESTED }) }),
    );
    expect(contracts.sendTemplate).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(['cre', 'rev'], expect.anything(), db);
  });

  it('refuses the Final Script while the Reviewer has not approved it', async () => {
    const { service } = setup({ status: ScriptStatus.SUBMITTED, currentVersion: 1 });
    await expect(service.finalReview('p1', { approve: true }, ADMIN)).rejects.toThrow(/REVIEWER_APPROVED/);
  });
});
