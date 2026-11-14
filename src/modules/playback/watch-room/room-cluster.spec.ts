import type { Namespace, Socket } from 'socket.io';
import type { AppConfig } from 'src/config/app-config';
import { RoomCluster, type RoomStateOp } from './room-cluster';
import { ROOM_EVENT } from './room-events';

type Handler = (op: RoomStateOp) => void;

/** A namespace double: `in().fetchSockets()` answers every instance, `local` only this one. */
function namespace(all: object[] = [], local: object[] = []) {
  const handlers: Record<string, Handler> = {};
  const emit = jest.fn();
  const localEmit = jest.fn();
  const localIn = jest.fn(() => ({ fetchSockets: () => Promise.resolve(local) }));
  const raw = {
    on: jest.fn((event: string, handler: Handler) => (handlers[event] = handler)),
    serverSideEmit: jest.fn(),
    in: jest.fn(() => ({ fetchSockets: () => Promise.resolve(all) })),
    to: jest.fn(() => ({ emit })),
    local: { in: localIn, to: jest.fn(() => ({ emit: localEmit })) },
  };
  return { server: raw as unknown as Namespace, raw, handlers, emit, localEmit, localIn };
}

const clusterOf = (redisUrl: string | null) => new RoomCluster({ redisUrl } as unknown as AppConfig);
const message = { id: 'm1', userId: 'u', fullName: 'An', text: 'hi', sentAt: 1 };

describe('RoomCluster', () => {
  let cluster: RoomCluster;
  afterEach(() => cluster?.onModuleDestroy());

  it('mirrors a change to the other instances only when sockets go through Redis', () => {
    cluster = clusterOf('redis://r:6379');
    const ns = namespace();
    cluster.attach(ns.server);
    cluster.attach(ns.server); // the second gateway attaches the same namespace
    expect(ns.raw.on).toHaveBeenCalledTimes(1);
    cluster.publish({ t: 'drop', roomId: 'r1' });
    expect(ns.raw.serverSideEmit).toHaveBeenCalledWith('watch-room:state', { t: 'drop', roomId: 'r1' });

    const single = clusterOf(null);
    const alone = namespace();
    single.attach(alone.server);
    single.publish({ t: 'drop', roomId: 'r1' });
    expect(alone.raw.on).not.toHaveBeenCalled();
    expect(alone.raw.serverSideEmit).not.toHaveBeenCalled();
    single.onModuleDestroy();
  });

  it('replays the live clock, the Host and the shared screen sent by another instance', () => {
    cluster = clusterOf('redis://r:6379');
    const ns = namespace();
    cluster.attach(ns.server);
    cluster.live.seed('r1', 'host-a', 'PAUSED', 0);
    const replay = ns.handlers['watch-room:state'];

    replay({ t: 'sync', roomId: 'r1', state: 'PLAYING', positionSeconds: 42 });
    replay({ t: 'host', roomId: 'r1', hostUserId: 'host-b' });
    replay({ t: 'quality', roomId: 'r1', quality: '720p' });
    replay({ t: 'chat', roomId: 'r1', message });
    replay({ t: 'chat', roomId: 'r1', message }); // delivered twice, kept once

    expect(cluster.live.get('r1')).toMatchObject({ state: 'PLAYING', positionSeconds: 42, hostUserId: 'host-b' });
    expect(cluster.screen.snapshot('r1')).toMatchObject({ quality: '720p', chat: [{ id: 'm1' }] });
    expect(ns.emit).not.toHaveBeenCalled(); // the instance that made the change already told the room

    replay({ t: 'drop', roomId: 'r1' });
    expect(cluster.live.get('r1')).toBeUndefined();
  });

  it('counts a vote cast on another instance without deciding it there', () => {
    cluster = clusterOf('redis://r:6379');
    cluster.live.seed('r1', 'host', 'PAUSED', 0);
    cluster.live.get('r1')!.voteOpen = true;
    cluster.apply({ t: 'vote', roomId: 'r1', userId: 'm1' });
    // Two of three members want the change: the local vote of m2 carries it.
    expect(cluster.live.vote('r1', 'm2', 3)).toBe(true);
  });

  it('unseats the older socket of this instance when the member sat down on another one', () => {
    cluster = clusterOf('redis://r:6379');
    const old = { id: 's-old', data: { roomId: 'r1' }, emit: jest.fn(), leave: jest.fn() };
    cluster.seats.connect('m1', old as unknown as Socket);
    cluster.seats.take('r1', 'm1', old as unknown as Socket);

    cluster.apply({ t: 'unseat', roomId: 'r1', userId: 'm1', keepSocketId: 's-new' });

    expect(old.emit).toHaveBeenCalledWith(ROOM_EVENT.SESSION_REPLACED, expect.objectContaining({ roomId: 'r1' }));
    expect(old.leave).toHaveBeenCalled();
    expect(old.data.roomId).toBeUndefined();
    expect(cluster.seats.isSeated('r1', 'm1')).toBe(false);

    const kept = { id: 's-new', data: {}, emit: jest.fn(), leave: jest.fn() };
    cluster.seats.connect('m1', kept as unknown as Socket);
    cluster.seats.take('r1', 'm1', kept as unknown as Socket);
    cluster.apply({ t: 'unseat', roomId: 'r1', userId: 'm1', keepSocketId: 's-new' });
    expect(kept.emit).not.toHaveBeenCalled();
  });

  it('cancels the Host grace when the Host came back on another instance, and tells the room', () => {
    jest.useFakeTimers();
    cluster = clusterOf('redis://r:6379');
    const ns = namespace();
    cluster.attach(ns.server);
    const expire = jest.fn();
    cluster.startGrace('r1', 45_000, expire);

    cluster.apply({ t: 'hostBack', roomId: 'r1' });
    jest.advanceTimersByTime(60_000);

    expect(expire).not.toHaveBeenCalled();
    expect(ns.emit).toHaveBeenCalledWith(ROOM_EVENT.HOST_RECONNECTED, { roomId: 'r1' });
    jest.useRealTimers();
  });

  it('lets a grace nobody cancelled run out', () => {
    jest.useFakeTimers();
    cluster = clusterOf(null);
    const expire = jest.fn();
    cluster.startGrace('r1', 45_000, expire);
    jest.advanceTimersByTime(45_000);
    expect(expire).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('finds a member and their seat on any instance', async () => {
    cluster = clusterOf('redis://r:6379');
    const ns = namespace([{ data: { userId: 'host' } }]);
    cluster.attach(ns.server);
    await expect(cluster.isSeated('r1', 'host')).resolves.toBe(true);
    await expect(cluster.isSeated('r1', 'other')).resolves.toBe(false);
    await expect(cluster.isOnline('host')).resolves.toBe(true);
  });

  it('pulses only the sockets of this instance and forgets a room nobody here watches', async () => {
    cluster = clusterOf('redis://r:6379');
    const ns = namespace([], [{ id: 's1' }]);
    cluster.attach(ns.server);
    cluster.live.seed('r1', 'host', 'PLAYING', 10);

    await cluster.pulse();
    expect(ns.localEmit).toHaveBeenCalledWith(ROOM_EVENT.HEARTBEAT_SYNC, expect.objectContaining({ state: 'PLAYING' }));
    expect(ns.emit).not.toHaveBeenCalled();

    ns.localIn.mockReturnValue({ fetchSockets: () => Promise.resolve([]) });
    await cluster.pulse();
    expect(cluster.live.get('r1')).toBeUndefined();
  });
});
