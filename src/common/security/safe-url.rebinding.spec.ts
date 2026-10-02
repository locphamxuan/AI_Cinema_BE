import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeGet } from './safe-url';

// The up-front check sees a public address, the connection then resolves to loopback.
jest.mock('node:dns/promises', () => ({
  lookup: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
}));
jest.mock('node:dns', () => ({
  lookup: (
    _host: string,
    _options: object,
    callback: (error: null, addresses: { address: string; family: number }[]) => void,
  ) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
}));

describe('Import URL guard against DNS rebinding', () => {
  let server: Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits += 1;
      res.end('internal secret');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('checks the address the socket connects to, not only the first lookup', async () => {
    await expect(safeGet(`http://rebind.example:${port}/`, { allowPrivate: false })).rejects.toThrow(
      'private or local network address',
    );
    expect(hits).toBe(0);
  });
});
