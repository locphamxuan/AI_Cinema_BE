import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';

/**
 * Hearts and the saved list are a viewer's own taste (BR-07, BR-63): they feed the ranking and the
 * recommendations, so a staff or Studio account testing the catalog must not move them.
 */
export function assertMember(user: Pick<AuthenticatedUser, 'role'>): void {
  if (user.role === UserRole.MEMBER) return;
  throw new ForbiddenException({
    message: 'Only member accounts can like or save movies',
    details: { reason: 'MEMBERS_ONLY' },
  });
}
