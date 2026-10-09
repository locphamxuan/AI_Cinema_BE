import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import type { CoinAdjustService } from 'src/modules/episode-access/coin-wallet/coin-adjust.service';
import type { StatementService } from 'src/modules/episode-access/coin-wallet/statement/statement.service';
import type { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import { AdminWalletService } from './admin-wallet.service';

describe('AdminWalletService.wallet', () => {
  const wallets = { adminView: jest.fn(), walletOf: jest.fn() };
  const service = new AdminWalletService(
    {} as unknown as PrismaService,
    wallets as unknown as WalletService,
    {} as unknown as CoinAdjustService,
    {} as unknown as StatementService,
    {} as unknown as AuditLogService,
  );

  it('shows what a member’s wallet holds', async () => {
    wallets.adminView.mockResolvedValue({ id: 'w1', userId: 'u1', mainBalance: 10, lots: [] });

    await expect(service.wallet('u1')).resolves.toMatchObject({ id: 'w1', mainBalance: 10 });
    expect(wallets.adminView).toHaveBeenCalledWith('u1');
  });

  it('answers 404 when the member never opened a wallet', async () => {
    wallets.adminView.mockResolvedValue(null);

    await expect(service.wallet('ghost')).rejects.toMatchObject({
      response: {
        statusCode: 404,
        details: {
          reason: 'WALLET_NOT_FOUND',
        },
      },
    });
  });
});

describe('AdminWalletService.ledger', () => {
  const statements = { ledger: jest.fn().mockResolvedValue({ data: [] }) };
  const service = new AdminWalletService(
    {} as unknown as PrismaService,
    {} as unknown as WalletService,
    {} as unknown as CoinAdjustService,
    statements as unknown as StatementService,
    {} as unknown as AuditLogService,
  );
  const query = { path: '' } as never;

  it('passes the admin filters through, defaulting to everything', async () => {
    await service.ledger(
      { kind: undefined, entryType: undefined, walletId: 'w1', from: '2026-10-01', to: '2026-10-31' },
      query,
    );

    expect(statements.ledger).toHaveBeenCalledWith(
      {
        kind: 'ALL',
        entryType: undefined,
        walletId: 'w1',
        from: new Date('2026-10-01'),
        to: new Date('2026-10-31'),
      },
      query,
    );
  });
});

describe('AdminWalletService.adjust', () => {
  const tx = {};
  const prisma = { $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)) };
  const wallets = { adminView: jest.fn(), walletOf: jest.fn().mockResolvedValue({ id: 'w1' }) };
  const coins = {
    apply: jest.fn().mockResolvedValue({ transactionId: 'tx-a', mainBalance: 110, bonusBalance: 5 }),
  };
  const auditLog = { record: jest.fn() };
  const service = new AdminWalletService(
    prisma as unknown as PrismaService,
    wallets as unknown as WalletService,
    coins as unknown as CoinAdjustService,
    {} as never,
    auditLog as unknown as AuditLogService,
  );
  const admin = { id: 'admin-1' } as unknown as AuthenticatedUser;

  beforeEach(() => jest.clearAllMocks());

  it('corrects by appending, never by editing, and leaves an audit event', async () => {
    const result = await service.adjust({ userId: 'u1', mainAmount: 100, reason: '  comp  ' }, admin);

    expect(coins.apply).toHaveBeenCalledWith(
      tx,
      'w1',
      expect.objectContaining({ mainAmount: 100, reason: '  comp  ', createdById: 'admin-1' }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: CONTENT_EVENT.COIN_ADJUSTED,
        entityType: 'CoinWallet',
        entityId: 'w1',
        actorId: 'admin-1',
      }),
      tx,
    );
    expect(result).toEqual({
      userId: 'u1',
      transactionId: 'tx-a',
      mainAmount: 100,
      bonusAmount: 0,
      mainBalance: 110,
      bonusBalance: 5,
      reason: 'comp',
    });
  });
});
