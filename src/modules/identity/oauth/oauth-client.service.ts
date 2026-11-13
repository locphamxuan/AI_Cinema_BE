import { Injectable } from '@nestjs/common';
import type { OAuthClient } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { verifyPassword } from 'src/modules/identity/auth/credentials';
import { OAuthError, OAUTH_ERROR } from './oauth-error';

/** The client credentials of a token or revoke request: Basic header first, then the form body. */
export interface ClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

/** RFC 6749 §2.3.1: `Authorization: Basic base64(urlencode(id):urlencode(secret))`. */
export function credentialsFromBasic(header: string | undefined): ClientCredentials {
  if (!header?.startsWith('Basic ')) return {};
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return {};
  return {
    clientId: decodeURIComponent(decoded.slice(0, colon)),
    clientSecret: decodeURIComponent(decoded.slice(colon + 1)),
  };
}

/**
 * Registered clients (RFC 6749 §2). The browser-facing checks (`forAuthorize`) never authenticate the
 * client — nothing secret travels through the browser — but they pin `redirect_uri` literally, which is
 * what makes a stolen `client_id` useless. The back-channel (`authenticate`) checks the secret when the
 * client has one; a public client relies on PKCE alone.
 */
@Injectable()
export class OAuthClientService {
  constructor(private readonly prisma: PrismaService) {}

  /** An enabled client and the exact redirect_uri it registered; anything else is never redirected to. */
  async forAuthorize(clientId: string, redirectUri: string): Promise<OAuthClient> {
    const client = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    if (!client || !client.isEnabled) {
      throw new OAuthError(OAUTH_ERROR.INVALID_CLIENT, 'Unknown or disabled client_id');
    }
    if (!client.redirectUris.includes(redirectUri)) {
      throw new OAuthError(OAUTH_ERROR.INVALID_REQUEST, 'redirect_uri is not registered for this client');
    }
    return client;
  }

  /** Back-channel client authentication for /oauth/token and /oauth/revoke. */
  async authenticate(credentials: ClientCredentials): Promise<OAuthClient> {
    if (!credentials.clientId) throw OAuthError.invalidClient('Client authentication is required');
    const client = await this.prisma.oAuthClient.findUnique({ where: { clientId: credentials.clientId } });
    if (!client || !client.isEnabled) throw OAuthError.invalidClient('Unknown or disabled client');
    if (client.clientSecretHash) {
      const ok = await verifyPassword(credentials.clientSecret ?? '', client.clientSecretHash);
      if (!ok) throw OAuthError.invalidClient('Client authentication failed');
    }
    return client;
  }
}
