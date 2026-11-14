import { assertActiveAccount } from './room-socket-utils';

describe('assertActiveAccount (watch room socket, audit 2026-11-12)', () => {
  const prisma = (account: { isActive: boolean; role: string } | null) => ({
    user: { findUnique: jest.fn().mockResolvedValue(account) },
  });

  it('lets an active account connect', async () => {
    await expect(assertActiveAccount(prisma({ isActive: true, role: 'MEMBER' }), 'u1')).resolves.toBeUndefined();
  });

  it('refuses a locked or deleted account even with a valid token', async () => {
    await expect(assertActiveAccount(prisma({ isActive: false, role: 'MEMBER' }), 'u1')).rejects.toThrow(
      'account deactivated',
    );
    await expect(assertActiveAccount(prisma(null), 'u1')).rejects.toThrow('account deactivated');
  });

  it('refuses a non-Member account (2026-11-13)', async () => {
    await expect(assertActiveAccount(prisma({ isActive: true, role: 'STAFF' }), 'u1')).rejects.toThrow('members only');
  });
});
