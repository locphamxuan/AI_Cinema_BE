import { UserRole } from '@prisma/client';
import { PERMISSION, type PermissionKey } from 'src/common/auth/permissions';

/**
 * The scopes AI Cinema issues as an authorization server (RFC 6749 §3.3). A scope says three things:
 * what the consent screen tells the studio, which role may approve it, and which API permissions a token
 * carrying it may use — OAuthScopeGuard refuses every other route, so a Studio Web token is useless
 * anywhere but the studio portal.
 */
export interface ScopeDefinition {
  /** Shown on the consent screen, in Vietnamese: the FE renders it as-is. */
  description: string;
  /** Only an account with this role may approve the scope. */
  role: UserRole;
  /** Endpoint permissions the scope opens; a route needing none of them is refused. */
  permissions: PermissionKey[];
}

export const STUDIO_PORTAL_SCOPE = 'studio:portal';

export const OAUTH_SCOPES: Record<string, ScopeDefinition> = {
  [STUDIO_PORTAL_SCOPE]: {
    description:
      'Xem và ký hợp đồng, xem dự án đã ký và nộp phim của hãng phim bạn đại diện trên AI Cinema (chỉ các dự án còn hợp đồng hiệu lực).',
    role: UserRole.STUDIO,
    permissions: [PERMISSION.STUDIO_PORTAL],
  },
};

/** The scopes of a space-separated `scope` parameter, or null when one of them is unknown. */
export function parseScopes(scope: string): string[] | null {
  const requested = [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
  if (!requested.length) return null;
  return requested.every((name) => name in OAUTH_SCOPES) ? requested : null;
}

/** What the consent screen shows for the scopes asked for. */
export function describeScopes(scopes: string[]): { scope: string; description: string }[] {
  return scopes.map((scope) => ({ scope, description: OAUTH_SCOPES[scope].description }));
}

/** Every permission the granted scopes open. */
export function permissionsOfScopes(scopes: string[]): Set<string> {
  const held = new Set<string>();
  for (const scope of scopes) for (const permission of OAUTH_SCOPES[scope]?.permissions ?? []) held.add(permission);
  return held;
}

/** The roles allowed to approve these scopes; a studio scope is refused to everyone but a STUDIO account. */
export function rolesForScopes(scopes: string[]): UserRole[] {
  return [...new Set(scopes.map((scope) => OAUTH_SCOPES[scope].role))];
}
