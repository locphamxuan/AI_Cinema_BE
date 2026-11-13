import { UserRole } from '@prisma/client';

/** Claims of an access token. The refresh token is an opaque string, not a JWT. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  type: 'access';
  /**
   * Space-separated scopes, set only on a token the OAuth token endpoint issued to a registered client
   * (RFC 6749 §3.3). A token from POST /auth/login carries none and is not limited by OAuthScopeGuard.
   */
  scope?: string;
  /** The studio the token speaks for, carried so a studio token is bound to one studio (MF-1 OAuth). */
  studio_id?: string;
}

/** The caller of a request, as JwtAuthGuard and PermissionsGuard leave it on `request.user`. */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  /** Scopes of the OAuth token the caller presented; undefined for a plain login (no limit). */
  scopes?: string[];
  /** The studio the OAuth token was issued for; the studio-portal guard refuses any other one. */
  studioId?: string;
}

export const JWT_ALGORITHM = 'HS256';
