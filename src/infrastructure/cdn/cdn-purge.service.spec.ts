import { Logger } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import { CdnPurgeService } from './cdn-purge.service';

const ASSET_ID = 'asset-1';

const configWith = (purge: Partial<AppConfig['cdn']['purge']>): AppConfig =>
  ({
    cdn: {
      baseUrl: 'https://stream.aicinema.example',
      enabled: true,
      purge: { apiUrl: 'https://api.cloudflare.test/client/v4', ...purge },
    },
  }) as unknown as AppConfig;

describe('CdnPurgeService', () => {
  const configured = configWith({ zoneId: 'zone-1', apiToken: 'cf-token' });
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success":true}', { status: 200 }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('purges the asset prefix with the zone token, host and path only', async () => {
    const service = new CdnPurgeService(configured);

    await expect(service.purgeAsset(ASSET_ID)).resolves.toEqual({ purged: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.test/client/v4/zones/zone-1/purge_cache');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cf-token');
    // Cloudflare takes a prefix without the scheme; the trailing slash keeps it to this asset.
    expect(JSON.parse(init.body as string)).toEqual({
      prefixes: [`stream.aicinema.example/public/hls/${ASSET_ID}/`],
    });
  });

  it('skips the call and never throws when no Cloudflare credentials are set (local dev)', async () => {
    const service = new CdnPurgeService(configWith({}));

    expect(service.configured()).toBe(false);
    await expect(service.purgeAsset(ASSET_ID)).resolves.toEqual({ purged: false, reason: 'PURGE_NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused purge instead of failing the take-down', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":false}', { status: 403 }));
    const service = new CdnPurgeService(configured);

    await expect(service.purgeAsset(ASSET_ID)).resolves.toEqual({ purged: false, reason: 'PURGE_HTTP_403' });
  });

  it('swallows a network failure: the episode is already down in the database', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.cloudflare.test'));
    const service = new CdnPurgeService(configured);

    await expect(service.purgeAsset(ASSET_ID)).resolves.toEqual({ purged: false, reason: 'PURGE_REQUEST_FAILED' });
  });
});
