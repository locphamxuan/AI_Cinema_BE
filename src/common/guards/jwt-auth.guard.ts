import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { type AccessTokenPayload, type AuthenticatedUser, JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

/** Every route needs a valid access token unless it is marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    const hasToken = scheme === 'Bearer' && Boolean(token);

    // A public route still recognises a signed-in caller (e.g. the catalog), but never requires one.
    if (isPublic && !hasToken) return true;
    if (!hasToken) throw new UnauthorizedException('Missing bearer token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.type !== 'access') throw new UnauthorizedException('This token cannot be used to call the API');

    request.user = { id: payload.sub, role: payload.role };
    return true;
  }
}
