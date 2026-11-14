import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/common/decorators/require-permission.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { OAuthError, OAUTH_ERROR } from './oauth-error';
import { permissionsOfScopes } from './oauth-scopes';

export const OAUTH_OPEN_KEY = 'oauthOpen';

/**
 * Lets an OAuth-scoped token call a route that needs no permission of its own — today only
 * GET /auth/me, which Studio Web reads to show who is signed in.
 */
export const OAuthOpen = () => SetMetadata(OAUTH_OPEN_KEY, true);

/**
 * Runs after PermissionsGuard. A token from POST /auth/login has no scopes and passes untouched. A token
 * the OAuth token endpoint issued (Studio Web) may only call routes whose @RequirePermission is opened by
 * one of its scopes, so it cannot reach the Admin, Reviewer or Member APIs even if the account could.
 * A studio token is also bound to the studio it was issued for: once the account is moved to another
 * studio, or the studio is deactivated, every token it holds stops working before it expires.
 */
@Injectable()
export class OAuthScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user?.scopes) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    if (!this.reflector.getAllAndOverride<boolean>(OAUTH_OPEN_KEY, targets)) {
      const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
      const opened = permissionsOfScopes(user.scopes);
      if (!required.some((permission) => opened.has(permission))) {
        throw new OAuthError(OAUTH_ERROR.INSUFFICIENT_SCOPE, 'This token may not call this endpoint', 403);
      }
    }
    if (user.studioId) await this.assertSameStudio(user);
    return true;
  }

  private async assertSameStudio(user: AuthenticatedUser): Promise<void> {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { studioId: true, studio: { select: { isActive: true } } },
    });
    if (!account || account.studioId !== user.studioId || !account.studio?.isActive) {
      throw new OAuthError(OAUTH_ERROR.INVALID_GRANT, 'The studio this token was issued for no longer applies', 401);
    }
  }
}
