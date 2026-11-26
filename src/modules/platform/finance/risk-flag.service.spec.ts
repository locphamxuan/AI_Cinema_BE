import { ConflictException, NotFoundException } from '@nestjs/common';
import { RISK_FLAGS_LINK, RiskFlagService } from './risk-flag.service';
import { RISK_RULES } from './risk-rules';

describe('RiskFlagService', () => {
  const tx = { transactionFlag: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() }, user: { update: jest.fn() } };
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(tx)),
    transactionFlag: { createMany: jest.fn(), findUnique: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const users = { signOutEverywhere: jest.fn() };
  const notifications = { notify: jest.fn(), adminIds: jest.fn().mockResolvedValue(['admin', 'admin-2']) };
  const service = new RiskFlagService(prisma as never, audit as never, users as never, notifications as never);
  const ADMIN = { id: 'admin', role: 'ADMIN' } as never;
  const member = { id: 'm1', role: 'MEMBER', isActive: true };
  const openFlag = (user: object = member) => ({
    id: 'f1',
    status: 'OPEN',
    ruleCode: 'LARGE_TOP_UP',
    coinTransactionId: 't1',
    coinTransaction: { wallet: { user } },
  });

  beforeEach(() => jest.clearAllMocks());

  it('runs every rule and stores each hit once, answering the new flags per rule', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 't1', reason: 'Nạp 6000000 VND trong một lần' }]);
    prisma.transactionFlag.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.scan()).resolves.toEqual({
      created: 1,
      rules: [{ code: 'LARGE_TOP_UP', description: RISK_RULES[0].description, created: 1 }],
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(RISK_RULES.length);
    expect(prisma.transactionFlag.createMany).toHaveBeenCalledWith({
      data: [{ coinTransactionId: 't1', ruleCode: 'LARGE_TOP_UP', reason: 'Nạp 6000000 VND trong một lần' }],
      skipDuplicates: true,
    });
  });

  it('leaves out a rule whose hits were all flagged before', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 't1', reason: 'x' }]);
    prisma.transactionFlag.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.scan()).resolves.toEqual({ created: 0, rules: [] });
  });

  it('tells every Admin about the flags the scheduled scan found, and stays quiet when there are none', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 't1', reason: 'a' },
      { id: 't2', reason: 'b' },
    ]);
    prisma.transactionFlag.createMany.mockResolvedValueOnce({ count: 2 });
    await service.scanAndNotify();
    expect(notifications.notify).toHaveBeenCalledWith(
      ['admin', 'admin-2'],
      expect.objectContaining({
        type: 'RISK_FLAGS_FOUND',
        title: 'Phát hiện 2 giao dịch rủi ro mới',
        body: `${RISK_RULES[0].description}: 2`,
        link: RISK_FLAGS_LINK,
      }),
    );

    notifications.notify.mockClear();
    prisma.$queryRaw.mockResolvedValue([]);
    await service.scanAndNotify();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('lets the Admin dismiss an open flag with a note, audited, without touching the account', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(openFlag());
    tx.transactionFlag.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.review('f1', 'DISMISSED', ' Hợp lệ ', ADMIN);
    expect(tx.transactionFlag.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'OPEN' },
      data: expect.objectContaining({ status: 'DISMISSED', reviewNote: 'Hợp lệ', reviewedById: 'admin' }),
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(users.signOutEverywhere).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRANSACTION_FLAG_REVIEWED' }), tx);
  });

  it('locks the member account from the flag, records who and why, then signs the member out', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(openFlag());
    tx.transactionFlag.updateMany.mockResolvedValueOnce({ count: 1 });
    await service.review('f1', 'ACCOUNT_LOCKED', 'Nạp lớn bất thường', ADMIN);
    expect(tx.transactionFlag.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'OPEN' },
      data: expect.objectContaining({
        status: 'ACCOUNT_LOCKED',
        reviewNote: 'Nạp lớn bất thường',
        reviewedById: 'admin',
      }),
    });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { isActive: false } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ decision: 'ACCOUNT_LOCKED', userId: 'm1', accountWasActive: true }),
      }),
      tx,
    );
    expect(users.signOutEverywhere).toHaveBeenCalledWith('m1');
  });

  it('never locks a staff account from a flag', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(openFlag({ id: 's1', role: 'STAFF', isActive: true }));
    await expect(service.review('f1', 'ACCOUNT_LOCKED', 'x', ADMIN)).rejects.toMatchObject({
      response: { details: { reason: 'RISK_FLAG_NOT_A_MEMBER' } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown flag, one already handled, and one another Admin handled meanwhile', async () => {
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(null);
    await expect(service.review('x', 'DISMISSED', undefined, ADMIN)).rejects.toThrow(NotFoundException);
    prisma.transactionFlag.findUnique.mockResolvedValueOnce({ ...openFlag(), status: 'ACCOUNT_LOCKED' });
    await expect(service.review('f1', 'DISMISSED', undefined, ADMIN)).rejects.toThrow(ConflictException);
    prisma.transactionFlag.findUnique.mockResolvedValueOnce(openFlag());
    tx.transactionFlag.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.review('f1', 'ACCOUNT_LOCKED', 'x', ADMIN)).rejects.toThrow(ConflictException);
    expect(users.signOutEverywhere).not.toHaveBeenCalled();
  });

  it('describes the rules for the Admin screen', () => {
    expect(service.rules().map((r) => r.code)).toEqual(['LARGE_TOP_UP', 'RAPID_UNLOCKS', 'REPEATED_REFUNDS']);
  });
});
