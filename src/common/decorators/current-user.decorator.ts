import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from 'src/common/auth/authenticated-user';

export const CurrentUser = createParamDecorator((data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
  if (!request.user) {
    throw new UnauthorizedException('Authentication required');
  }
  return data ? request.user[data] : request.user;
});
