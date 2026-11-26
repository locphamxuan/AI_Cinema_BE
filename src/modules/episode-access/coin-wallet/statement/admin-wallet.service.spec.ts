import type { StatementService } from 'src/modules/episode-access/coin-wallet/statement/statement.service';
import type { WalletService } from 'src/modules/episode-access/coin-wallet/wallet.service';
import { AdminWalletService } from './admin-wallet.service';

describe('AdminWalletService.wallet', () => {
  const wallets = { adminView: jest.fn(), walletOf: jest.fn() };
  const service = new AdminWalletService(wallets as unknown as WalletService, {} as unknown as StatementService);

  it('shows what a member’s wallet holds', async () => {
    wallets.adminView.mockResolvedValue({ id: 'w1', userId: 'u1', mainBalance: 10, lots: [] });

    await expect(service.wallet('u1')).resolves.toMatchObject({ id: 'w1', mainBalance: 10 });
    expect(wallets.adminView).toHaveBeenCalledWith('u1');
  });

  it('answers 404 when the member never opened a wallet', async () => {
    wallets.adminView.mockResolvedValue(null);

    await expect(service.wallet('ghost')).rejects.toMatchObject({
      status: 404,
      response: {
        details: {
          reason: 'WALLET_NOT_FOUND',
        },
      },
    });
  });
});

describe('AdminWalletService.ledger', () => {
  const statements = { ledger: jest.fn().mockResolvedValue({ data: [] }) };
  const service = new AdminWalletService({} as unknown as WalletService, statements as unknown as StatementService);
  const query = { path: '' } as never;

  it('passes the admin filters through, defaulting to everything', async () => {
    await service.ledger(
      {
        kind: undefined,
        entryType: undefined,
        walletId: 'w1',
        account: 'ha@test.vn',
        from: '2026-10-01',
        to: '2026-10-31',
      },
      query,
    );

    expect(statements.ledger).toHaveBeenCalledWith(
      {
        kind: 'ALL',
        entryType: undefined,
        walletId: 'w1',
        account: 'ha@test.vn',
        from: new Date('2026-10-01'),
        to: new Date('2026-10-31'),
      },
      query,
    );
  });
});
