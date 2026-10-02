import type { Prisma } from '@prisma/client';

/** Columns of an account that may leave the API: never the password hash. */
export const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  dateOfBirth: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{ select: typeof USER_PROFILE_SELECT }>;
