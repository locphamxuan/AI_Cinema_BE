import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Who triggered the work running now: set per HTTP request, absent in background jobs. */
const store = new AsyncLocalStorage<{ userId?: string }>();

export function currentActorId(): string | undefined {
  return store.getStore()?.userId;
}

/** Runs the handler inside the caller's context so deep services know who acted without threading it through. */
export function runAsActor<T>(userId: string | undefined, work: () => T): T {
  return store.run({ userId }, work);
}

/** Global interceptor: guards have run, so `request.user` is the signed-in caller (if any). */
@Injectable()
export class RequestActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const userId = context.switchToHttp().getRequest<{ user?: { id?: string } }>().user?.id;
    return new Observable((subscriber) => runAsActor(userId, () => next.handle().subscribe(subscriber)));
  }
}
