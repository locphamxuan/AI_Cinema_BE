/**
 * AI Cinema as an OAuth 2.0 authorization server (RFC 6749 + RFC 7636) for the third-party Studio Web.
 * The client itself (client_id, redirect_uris, optional secret) is a row of `oauth_clients` that
 * `prisma/seed.ts` writes from OAUTH_STUDIO_WEB_* — redirect_uris are matched literally, so each
 * environment registers its own. The API only needs how long a code lives.
 */
export interface OAuthConfig {
  /** Lifetime of an authorization code. RFC 6749 §4.1.2 wants it short; the exchange is immediate. */
  codeTtlSeconds: number;
}

export const DEFAULT_CODE_TTL_SECONDS = 60;
