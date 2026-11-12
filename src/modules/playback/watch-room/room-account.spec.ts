import { assertActiveAccount } from './room-socket-utils';

describe('assertActiveAccount (watch room socket, audit 2026-11-12)', () => {
  const prisma = (account: { isActive: boolean } | null) => ({
    user: { findUnique: jest.fn().mockResolvedValue(account) },
  });

  it('lets an active account connect', async () => {
    await expect(assertActiveAccount(prisma({ isActive: true }), 'u1')).resolves.toBeUndefined();
  });

  it('refuses a locked or deleted account even with a valid token', async () => {
    await expect(assertActiveAccount(prisma({ isActive: false }), 'u1')).rejects.toThrow('account deactivated');
    await expect(assertActiveAccount(prisma(null), 'u1')).rejects.toThrow('account deactivated');
  });
});
