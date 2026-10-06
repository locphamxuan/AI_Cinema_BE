import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';

/**
 * The caller of a public route: the signed-in member when there is one, otherwise undefined.
 * JwtAuthGuard puts the member on `request.user` even on a public route, so a screen that shows
 * Guests and Members differently can ask for it without requiring a token.
 */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
});
