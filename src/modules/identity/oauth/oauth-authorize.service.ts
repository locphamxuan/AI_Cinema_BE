import { Inject, Injectable } from '@nestjs/common';
import { CodeChallengeMethod, type OAuthClient, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuthorizeDecisionDto, AuthorizeQueryDto } from './dto/oauth.request.dto';
import { OAuthClientService } from './oauth-client.service';
import { OAuthError, OAUTH_ERROR } from './oauth-error';
import { describeScopes, parseScopes, rolesForScopes } from './oauth-scopes';
import { hashAuthorizationCode, isValidCodeChallenge, newAuthorizationCode } from './pkce';

/** What AI_Cinema_FE renders on the consent screen. */
export interface ConsentView {
  client: { clientId: string; name: string };
  scopes: { scope: string; description: string }[];
  account: { id: string; role: UserRole; studioName: string | null };
  redirectUri: string;
  state: string;
}

/**
 * RFC 6749 §4.1.1–4.1.2 with PKCE (RFC 7636): AI_Cinema_FE shows the login and consent screens; the
 * studio's decision comes here with the platform session the FE already holds, and the answer is the URL
 * the browser goes back to — `?code&state` on approval, `?error=access_denied&state` on refusal.
 * Problems found before the redirect_uri is trusted are answered as JSON, never redirected (§4.1.2.1).
 */
@Injectable()
export class OAuthAuthorizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: OAuthClientService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The consent screen: every check of the request, plus who is about to approve it. */
  async describe(user: AuthenticatedUser, query: AuthorizeQueryDto): Promise<ConsentView> {
    const { client, scopes } = await this.validate(query);
    const account = await this.assertMayApprove(user, scopes);
    return {
      client: { clientId: client.clientId, name: client.name },
      scopes: describeScopes(scopes),
      account,
      redirectUri: query.redirect_uri,
      state: query.state,
    };
  }

  /** The studio pressed "Cho phép" or "Từ chối"; answers where the browser goes next. */
  async decide(user: AuthenticatedUser, dto: AuthorizeDecisionDto): Promise<{ redirectTo: string }> {
    const { client, scopes } = await this.validate(dto);
    if (!dto.approve) {
      return { redirectTo: withParams(dto.redirect_uri, { error: OAUTH_ERROR.ACCESS_DENIED, state: dto.state }) };
    }
    await this.assertMayApprove(user, scopes);

    const code = newAuthorizationCode();
    await this.prisma.authorizationCode.create({
      data: {
        codeHash: hashAuthorizationCode(code),
        clientId: client.id,
        userId: user.id,
        scope: scopes.join(' '),
        redirectUri: dto.redirect_uri,
        codeChallenge: dto.code_challenge,
        codeChallengeMethod: CodeChallengeMethod.S256,
        expiresAt: new Date(Date.now() + this.config.oauth.codeTtlSeconds * 1000),
      },
    });
    return { redirectTo: withParams(dto.redirect_uri, { code, state: dto.state }) };
  }

  /** Client and redirect_uri first (never redirect to an unchecked URI), then the rest of the request. */
  private async validate(query: AuthorizeQueryDto): Promise<{ client: OAuthClient; scopes: string[] }> {
    const client = await this.clients.forAuthorize(query.client_id, query.redirect_uri);
    if (query.response_type !== 'code') {
      throw new OAuthError(OAUTH_ERROR.UNSUPPORTED_RESPONSE_TYPE, 'Only response_type=code is supported');
    }
    const scopes = parseScopes(query.scope);
    if (!scopes || !scopes.every((scope) => client.scopes.includes(scope))) {
      throw new OAuthError(OAUTH_ERROR.INVALID_SCOPE, 'Unknown scope, or one this client may not ask for');
    }
    // RFC 9700 §2.1.1: PKCE with S256 is mandatory; PLAIN would make the challenge as public as the code.
    if (query.code_challenge_method !== 'S256' || !isValidCodeChallenge(query.code_challenge)) {
      throw new OAuthError(OAUTH_ERROR.INVALID_REQUEST, 'A S256 code_challenge of 43 characters is required');
    }
    if (!query.state.trim()) throw new OAuthError(OAUTH_ERROR.INVALID_REQUEST, 'state is required');
    return { client, scopes };
  }

  /**
   * Only the role a scope names may approve it: a Member, Reviewer or Admin who opens the link sees
   * access_denied. A studio account must belong to an active studio — a deactivated partner cannot
   * hand out new tokens.
   */
  private async assertMayApprove(user: AuthenticatedUser, scopes: string[]): Promise<ConsentView['account']> {
    if (!rolesForScopes(scopes).includes(user.role)) {
      throw new OAuthError(OAUTH_ERROR.ACCESS_DENIED, 'This account cannot approve the requested scope', 403);
    }
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { studio: { select: { name: true, isActive: true } } },
    });
    if (user.role === UserRole.STUDIO && !account?.studio?.isActive) {
      throw new OAuthError(OAUTH_ERROR.ACCESS_DENIED, 'This studio account is not tied to an active studio', 403);
    }
    return { id: user.id, role: user.role, studioName: account?.studio?.name ?? null };
  }
}

/** `redirect_uri` plus the answer parameters, keeping any query the client registered. */
function withParams(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
