import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PERMISSION, type PermissionKey } from 'src/common/auth/permissions';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AccessControlService } from 'src/modules/identity/access-control/access-control.service';
import { MemberContextService } from './member-context.service';

const CONVERSATION_ID = 'conversation-1';
const MEMBER_ID = 'member-1';
const STAFF = { id: 'staff-1', role: UserRole.STAFF };

function buildService(held: Set<PermissionKey>) {
  const prisma = {
    supportConversation: { findUnique: jest.fn().mockResolvedValue({ memberId: MEMBER_ID }) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: MEMBER_ID, email: 'abc@gmail.com', fullName: 'Thành viên' }),
    },
    subscription: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE', plan: { code: 'MONTHLY' } }) },
    coinWallet: { findUnique: jest.fn().mockResolvedValue({ mainBalance: 100, bonusBalance: 20, lots: [] }) },
    coinTransaction: { findMany: jest.fn().mockResolvedValue([{ entryType: 'TOPUP' }]) },
    episodeAccess: { findMany: jest.fn().mockResolvedValue([{ source: 'COIN_UNLOCK' }]) },
    userDevice: { findMany: jest.fn().mockResolvedValue([{ name: 'iPhone 15' }]) },
    streamingSession: { findMany: jest.fn().mockResolvedValue([{ status: 'ENDED' }]) },
  };
  const accessControl = { permissionsOf: jest.fn().mockResolvedValue(held) };
  const service = new MemberContextService(
    prisma as unknown as PrismaService,
    accessControl as unknown as AccessControlService,
  );
  return { service, prisma, accessControl };
}

const ALL_PERMISSIONS = new Set<PermissionKey>([
  PERMISSION.MEMBER_OPS_READ,
  PERMISSION.USER_READ,
  PERMISSION.BILLING_SUBSCRIPTION_READ,
  PERMISSION.WALLET_READ,
  PERMISSION.COIN_WALLET_READ,
  PERMISSION.COIN_TRANSACTION_READ,
  PERMISSION.ACCESS_EPISODE_READ,
]);

describe('MemberContextService.getContext', () => {
  it('returns 404 for a missing conversation', async () => {
    const { service, prisma } = buildService(ALL_PERMISSIONS);
    prisma.supportConversation.findUnique.mockResolvedValue(null);

    await expect(service.getContext(CONVERSATION_ID, STAFF)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grants every section when the caller holds all required permissions', async () => {
    const { service, prisma, accessControl } = buildService(ALL_PERMISSIONS);

    const result = await service.getContext(CONVERSATION_ID, STAFF);

    expect(accessControl.permissionsOf).toHaveBeenCalledTimes(1);
    expect(accessControl.permissionsOf).toHaveBeenCalledWith(UserRole.STAFF);
    expect(result.memberId).toBe(MEMBER_ID);
    for (const section of Object.keys(result.sections)) {
      expect(result.sections[section].restricted).toBe(false);
      expect(result.sections[section].permission).toBe('granted');
      expect(result.sections[section].data).not.toBeNull();
    }
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MEMBER_ID } }));
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MEMBER_ID } }),
    );
    expect(prisma.coinWallet.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MEMBER_ID } }),
    );
    expect(prisma.coinTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { wallet: { userId: MEMBER_ID } } }),
    );
    expect(prisma.episodeAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MEMBER_ID } }),
    );
    expect(prisma.userDevice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: MEMBER_ID } }));
    expect(prisma.streamingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MEMBER_ID } }),
    );
    // Devices is a bundle: registered devices plus recent playback sessions.
    expect(result.sections.Devices.data).toMatchObject({
      devices: [{ name: 'iPhone 15' }],
      sessions: [{ status: 'ENDED' }],
    });
  });

  it('restricts every section without failing the whole context when no permission is held', async () => {
    const { service, prisma } = buildService(new Set());

    const result = await service.getContext(CONVERSATION_ID, STAFF);

    expect(Object.keys(result.sections)).toEqual([
      'Account',
      'Subscription',
      'Wallet',
      'Transactions',
      'EpisodeAccess',
      'Devices',
    ]);
    for (const section of Object.keys(result.sections)) {
      expect(result.sections[section].data).toBeNull();
      expect(result.sections[section].restricted).toBe(true);
    }
    expect(result.sections.Account.permission).toBe('member:ops.read or user:read');
    expect(result.sections.Wallet.permission).toBe('wallet.read or coin.wallet.read');
    expect(result.sections.Subscription.permission).toBe('billing.subscription.read');
    expect(result.memberId).toBe(MEMBER_ID);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.coinWallet.findUnique).not.toHaveBeenCalled();
    expect(prisma.coinTransaction.findMany).not.toHaveBeenCalled();
    expect(prisma.episodeAccess.findMany).not.toHaveBeenCalled();
    expect(prisma.userDevice.findMany).not.toHaveBeenCalled();
    expect(prisma.streamingSession.findMany).not.toHaveBeenCalled();
  });

  it('accepts either wallet permission (some-of-set semantics)', async () => {
    for (const key of [PERMISSION.WALLET_READ, PERMISSION.COIN_WALLET_READ]) {
      const { service, prisma } = buildService(new Set([key]));
      const result = await service.getContext(CONVERSATION_ID, STAFF);
      expect(result.sections.Wallet.restricted).toBe(false);
      expect(prisma.coinWallet.findUnique).toHaveBeenCalled();
    }
  });

  it('grants Account and Devices for user:read but nothing billing', async () => {
    const { service } = buildService(new Set([PERMISSION.USER_READ]));

    const result = await service.getContext(CONVERSATION_ID, STAFF);

    expect(result.sections.Account.restricted).toBe(false);
    expect(result.sections.Devices.restricted).toBe(false);
    expect(result.sections.Subscription.restricted).toBe(true);
    expect(result.sections.Wallet.restricted).toBe(true);
    expect(result.sections.Transactions.restricted).toBe(true);
    expect(result.sections.EpisodeAccess.restricted).toBe(true);
  });

  it('grants Account and Devices for member:ops.read', async () => {
    const { service } = buildService(new Set([PERMISSION.MEMBER_OPS_READ]));

    const result = await service.getContext(CONVERSATION_ID, STAFF);

    expect(result.sections.Account.restricted).toBe(false);
    expect(result.sections.Devices.restricted).toBe(false);
    expect(result.sections.Subscription.restricted).toBe(true);
  });

  it('loads only the requested section and still gates it', async () => {
    const { service, prisma } = buildService(new Set([PERMISSION.WALLET_READ]));

    const granted = await service.getContext(CONVERSATION_ID, STAFF, 'Wallet');

    expect(Object.keys(granted.sections)).toEqual(['Wallet']);
    expect(granted.sections.Wallet.restricted).toBe(false);
    expect(prisma.coinWallet.findUnique).toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();

    const restricted = await service.getContext(CONVERSATION_ID, STAFF, 'Transactions');
    expect(Object.keys(restricted.sections)).toEqual(['Transactions']);
    expect(restricted.sections.Transactions.restricted).toBe(true);
    expect(restricted.sections.Transactions.permission).toBe('coin.transaction.read');
  });

  it('never selects token, password or device keys for staff screens', async () => {
    const { service, prisma } = buildService(ALL_PERMISSIONS);

    await service.getContext(CONVERSATION_ID, STAFF);

    const accountCall = prisma.user.findUnique.mock.calls[0] as [{ select: Record<string, unknown> }] | undefined;

    if (!accountCall) {
      throw new Error('Expected user.findUnique to be called');
    }

    const accountSelect = accountCall[0].select;
    expect(accountSelect).not.toHaveProperty('passwordHash');

    const deviceCall = prisma.userDevice.findMany.mock.calls[0] as [{ select: Record<string, unknown> }] | undefined;

    if (!deviceCall) {
      throw new Error('Expected userDevice.findMany to be called');
    }

    const deviceSelect = deviceCall[0].select;
    expect(deviceSelect).not.toHaveProperty('deviceKey');

    const sessionCall = prisma.streamingSession.findMany.mock.calls[0] as
      [{ select: Record<string, unknown> }] | undefined;

    if (!sessionCall) {
      throw new Error('Expected streamingSession.findMany to be called');
    }

    const sessionSelect = sessionCall[0].select;
    expect(sessionSelect).not.toHaveProperty('ipAddress');
    expect(sessionSelect).not.toHaveProperty('guestKey');
  });
});
