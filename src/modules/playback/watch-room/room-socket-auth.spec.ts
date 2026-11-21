import { socketAuth } from './room-socket-utils';

const socket = (token?: string) => ({
  handshake: { auth: token ? { token } : {}, headers: {} },
  data: {} as { userId?: string },
});

describe('socketAuth (handshake middleware of /watch)', () => {
  it('admits the socket with its member id before the client hears "connect"', async () => {
    const s = socket('good');
    const next = jest.fn();
    socketAuth((token) => (token === 'good' ? Promise.resolve('u1') : Promise.reject(new Error('bad'))))(s, next);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(s.data.userId).toBe('u1');
    expect(next).toHaveBeenCalledWith();
  });

  it('refuses the handshake with UNAUTHENTICATED, so no event ever runs without a member', async () => {
    const s = socket();
    const next = jest.fn();
    socketAuth(() => Promise.reject(new Error('expired')))(s, next);
    await new Promise((resolve) => process.nextTick(resolve));

    const [error] = next.mock.calls[0] as [Error & { data: unknown }];
    expect(error.message).toBe('UNAUTHENTICATED');
    expect(error.data).toEqual({ reason: 'UNAUTHENTICATED' });
    expect(s.data.userId).toBeUndefined();
  });
});
