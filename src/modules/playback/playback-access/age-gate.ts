import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { isAdult } from 'src/modules/identity/auth/credentials';

/** Movie labels only confirmed adults may watch (BR-68, Điều 44 Luật Điện ảnh 134/2025/QH15). */
const ADULT_LABELS = new Set(['T18']);

export function isAdultOnly(ageRating: string | null | undefined): boolean {
  return ADULT_LABELS.has(ageRating ?? '');
}

/**
 * The age gate of every way to watch: a T18 episode plays only for an account whose date of birth
 * shows 18 or older. A guest, or a member who signed up with Google and never gave a date of birth,
 * is refused like a minor — the same rule the recommendations apply.
 */
export async function assertOldEnough(
  prisma: Pick<PrismaService, 'user'>,
  ageRating: string | null | undefined,
  userId: string | undefined,
  message = 'This episode is for viewers aged 18 or older',
): Promise<void> {
  if (!isAdultOnly(ageRating)) return;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } }) : null;
  if (user?.dateOfBirth && isAdult(user.dateOfBirth)) return;
  throw new ForbiddenException({ message, details: { reason: 'AGE_RESTRICTED', ageRating: 'T18' } });
}
