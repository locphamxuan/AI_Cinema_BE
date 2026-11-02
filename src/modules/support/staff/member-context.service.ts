import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION, type PermissionKey } from 'src/common/auth/permissions';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AccessControlService } from 'src/modules/identity/access-control/access-control.service';

export const MEMBER_CONTEXT_SECTION = {
  ACCOUNT: 'Account',
  SUBSCRIPTION: 'Subscription',
  WALLET: 'Wallet',
  TRANSACTIONS: 'Transactions',
  EPISODE_ACCESS: 'EpisodeAccess',
  DEVICES: 'Devices',
} as const;

export type MemberContextSection = (typeof MEMBER_CONTEXT_SECTION)[keyof typeof MEMBER_CONTEXT_SECTION];

export const MEMBER_CONTEXT_SECTIONS = Object.values(MEMBER_CONTEXT_SECTION);

/** Plan §6.2: each section is gated by a permission the Staff/Admin role must hold. */
const SECTION_PERMISSIONS: Record<MemberContextSection, PermissionKey[]> = {
  Account: [PERMISSION.MEMBER_OPS_READ, PERMISSION.USER_READ],
  Subscription: [PERMISSION.BILLING_SUBSCRIPTION_READ],
  Wallet: [PERMISSION.WALLET_READ, PERMISSION.COIN_WALLET_READ],
  Transactions: [PERMISSION.COIN_TRANSACTION_READ],
  EpisodeAccess: [PERMISSION.ACCESS_EPISODE_READ],
  Devices: [PERMISSION.MEMBER_OPS_READ, PERMISSION.USER_READ],
};

export interface MemberContextSectionResult {
  data: unknown;
  restricted: boolean;
  permission: string;
}

/**
 * The member snapshot Staff reads while handling a case. A section the caller may not read is
 * returned as `{ data: null, restricted: true }` rather than a 403, so the screen still shows
 * the sections the caller is allowed to see.
 */
@Injectable()
export class MemberContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControl: AccessControlService,
  ) {}

  async getContext(conversationId: string, user: AuthenticatedUser, section?: MemberContextSection) {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      select: { memberId: true },
    });
    if (!conversation) throw new NotFoundException('Support conversation not found');

    const held = await this.accessControl.permissionsOf(user.role);
    const wanted = section ? [section] : MEMBER_CONTEXT_SECTIONS;
    const sections: Record<string, MemberContextSectionResult> = {};

    for (const current of wanted) {
      const required = SECTION_PERMISSIONS[current];
      if (!required.some((permission) => held.has(permission))) {
        sections[current] = { data: null, restricted: true, permission: required.join(' or ') };
        continue;
      }
      sections[current] = {
        data: await this.loadSection(current, conversation.memberId),
        restricted: false,
        permission: 'granted',
      };
    }

    return { memberId: conversation.memberId, sections };
  }

  private loadSection(section: MemberContextSection, memberId: string): Promise<unknown> {
    switch (section) {
      case MEMBER_CONTEXT_SECTION.ACCOUNT:
        return this.prisma.user.findUnique({
          where: { id: memberId },
          select: {
            id: true,
            email: true,
            fullName: true,
            phoneNumber: true,
            dateOfBirth: true,
            role: true,
            isActive: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
        });

      case MEMBER_CONTEXT_SECTION.SUBSCRIPTION:
        return this.prisma.subscription.findFirst({
          where: { userId: memberId },
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            autoRenew: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            nextRenewalAt: true,
            cancelWindowEndsAt: true,
            priceCoins: true,
            plan: { select: { code: true, name: true, period: true, features: true } },
          },
        });

      case MEMBER_CONTEXT_SECTION.WALLET:
        return this.prisma.coinWallet.findUnique({
          where: { userId: memberId },
          select: {
            mainBalance: true,
            bonusBalance: true,
            updatedAt: true,
            lots: {
              where: { remainingAmount: { gt: 0 }, expiresAt: { gt: new Date() } },
              orderBy: { expiresAt: 'asc' },
              take: 5,
              select: { source: true, remainingAmount: true, grantedAt: true, expiresAt: true },
            },
          },
        });

      case MEMBER_CONTEXT_SECTION.TRANSACTIONS:
        return this.prisma.coinTransaction.findMany({
          where: { wallet: { userId: memberId } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            entryType: true,
            mainAmount: true,
            bonusAmount: true,
            description: true,
            mainBalanceAfter: true,
            bonusBalanceAfter: true,
            createdAt: true,
          },
        });

      case MEMBER_CONTEXT_SECTION.EPISODE_ACCESS:
        return this.prisma.episodeAccess.findMany({
          where: { userId: memberId },
          orderBy: { grantedAt: 'desc' },
          take: 20,
          select: {
            source: true,
            paidCoins: true,
            grantedAt: true,
            revokedAt: true,
            revokeReason: true,
            episode: {
              select: { episodeNumber: true, title: true, movie: { select: { title: true } } },
            },
          },
        });

      case MEMBER_CONTEXT_SECTION.DEVICES:
        return Promise.all([
          this.prisma.userDevice.findMany({
            where: { userId: memberId },
            orderBy: { lastSeenAt: 'desc' },
            take: 20,
            select: { name: true, platform: true, createdAt: true, lastSeenAt: true },
          }),
          this.prisma.streamingSession.findMany({
            where: { userId: memberId },
            orderBy: { startedAt: 'desc' },
            take: 10,
            select: {
              status: true,
              accessType: true,
              startedAt: true,
              endedAt: true,
              endReason: true,
              episode: { select: { episodeNumber: true, title: true } },
            },
          }),
        ]).then(([devices, sessions]) => ({ devices, sessions }));

      default:
        return Promise.resolve(null);
    }
  }
}
