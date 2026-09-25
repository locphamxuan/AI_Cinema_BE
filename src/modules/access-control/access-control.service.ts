import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ALL_PERMISSIONS, LOCKED_ADMIN_PERMISSIONS, type PermissionKey } from 'src/common/auth/permissions';

export interface AccountState {
  role: UserRole;
  isActive: boolean;
}

// A role change or deactivation reaches other server instances within this delay;
// on this instance it applies at once because the Admin's update clears the cache.
const ACCOUNT_TTL_MS = 30_000;

/**
 * Answers "may this account do that?" from the database, keeping the answers in memory
 * so a request does not pay a database round-trip for them.
 */
@Injectable()
export class AccessControlService {
  private rolePermissions: Map<UserRole, Set<string>> | null = null;
  private readonly accounts = new Map<string, AccountState & { expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async permissionsOf(role: UserRole): Promise<Set<string>> {
    if (!this.rolePermissions) {
      const rows = await this.prisma.rolePermission.findMany();
      const byRole = new Map<UserRole, Set<string>>(Object.values(UserRole).map((r) => [r, new Set<string>()]));
      for (const row of rows) byRole.get(row.role)?.add(row.permissionKey);
      this.rolePermissions = byRole;
    }
    return this.rolePermissions.get(role) ?? new Set();
  }

  /** The account's current role and status, not the ones frozen in its token. */
  async accountState(userId: string): Promise<AccountState | null> {
    const cached = this.accounts.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
    if (!user) {
      this.accounts.delete(userId);
      return null;
    }
    this.accounts.set(userId, { ...user, expiresAt: Date.now() + ACCOUNT_TTL_MS });
    return user;
  }

  forgetAccount(userId: string) {
    this.accounts.delete(userId);
  }

  async listPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ area: 'asc' }, { key: 'asc' }] });
  }

  async listRoles() {
    return Promise.all(
      Object.values(UserRole).map(async (role) => ({
        role,
        permissions: [...(await this.permissionsOf(role))].sort(),
        lockedPermissions: role === UserRole.ADMIN ? LOCKED_ADMIN_PERMISSIONS : [],
      })),
    );
  }

  /** Replaces the whole permission set of a role. */
  async setRolePermissions(role: UserRole, permissions: string[]) {
    const wanted = [...new Set(permissions)];
    const unknown = wanted.filter((p) => !ALL_PERMISSIONS.includes(p as PermissionKey));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    if (role === UserRole.ADMIN) {
      const missing = LOCKED_ADMIN_PERMISSIONS.filter((p) => !wanted.includes(p));
      if (missing.length) {
        throw new BadRequestException(`ADMIN must keep ${missing.join(', ')} so the platform stays manageable`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { role } }),
      this.prisma.rolePermission.createMany({ data: wanted.map((permissionKey) => ({ role, permissionKey })) }),
    ]);
    this.rolePermissions = null;
    return { role, permissions: [...(await this.permissionsOf(role))].sort() };
  }
}
