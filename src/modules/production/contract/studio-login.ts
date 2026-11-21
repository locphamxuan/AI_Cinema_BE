import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/**
 * A contract goes to a studio that can open it: the studio signs on Studio Web, so it needs at least one active
 * STUDIO login account. A studio the Admin typed in on the spot has none until the Admin opens one (Studios >
 * Login accounts); refusing here keeps the mail from inviting a studio to a page it cannot enter.
 */
export async function assertStudioCanSign(tx: PrismaTx, studioId: string, studioName: string): Promise<void> {
  const accounts = await tx.user.count({ where: { studioId, role: UserRole.STUDIO, isActive: true } });
  if (accounts > 0) return;
  throw new ConflictException({
    message: `Studio "${studioName}" has no active Studio Web login account yet; open one before sending the contract`,
    details: { reason: 'STUDIO_HAS_NO_LOGIN', studioId },
  });
}
