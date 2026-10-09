import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();

  return request.headers['idempotency-key'];
});
