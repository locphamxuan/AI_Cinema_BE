import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { PERMISSIONS_KEY } from 'src/common/decorators/require-permission.decorator';
import { AccessControlService } from './access-control.service';

/**
 * Runs after JwtAuthGuard. Refreshes the caller's role from the database (so a role change
 * or a deactivation applies without waiting for the token to expire), then checks the
 * permissions the endpoint names with @RequirePermission().
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!user) return true;

    const account = await this.accessControl.accountState(user.id);
    if (!account) throw new UnauthorizedException('Account no longer available');
    if (!account.isActive) throw new UnauthorizedException('This account has been deactivated');
    user.role = account.role;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (!required?.length) return true;

    const held = await this.accessControl.permissionsOf(user.role);
    if (!required.some((permission) => held.has(permission))) {
      throw new ForbiddenException(`This action requires the permission ${required.join(' or ')}`);
    }
    return true;
  }
}
