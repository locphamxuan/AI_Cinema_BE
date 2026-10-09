import { UserRole } from '@prisma/client';

/** Claims of an access token. The refresh token is an opaque string, not a JWT. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: 'access';
}

/** The caller of a request, as JwtAuthGuard and PermissionsGuard leave it on `request.user`. */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

export const JWT_ALGORITHM = 'HS256';
