import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';

/** The caller on a @Public() route when a valid token was sent; undefined for a Guest. */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
});
