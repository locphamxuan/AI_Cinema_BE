import { lastValueFrom, of, defer } from 'rxjs';
import { currentActorId, RequestActorInterceptor, runAsActor } from './request-actor';

const http = (user?: { id: string }) =>
  ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

describe('RequestActorInterceptor', () => {
  it('exposes the signed-in caller to the code the handler runs', async () => {
    const seen = await lastValueFrom(
      new RequestActorInterceptor().intercept(http({ id: 'u1' }), { handle: () => defer(() => of(currentActorId())) }),
    );
    expect(seen).toBe('u1');
  });

  it('has no actor outside a request or for a guest', async () => {
    expect(currentActorId()).toBeUndefined();
    const seen = await lastValueFrom(
      new RequestActorInterceptor().intercept(http(), { handle: () => defer(() => of(currentActorId())) }),
    );
    expect(seen).toBeUndefined();
    expect(runAsActor('u2', () => currentActorId())).toBe('u2');
  });
});
