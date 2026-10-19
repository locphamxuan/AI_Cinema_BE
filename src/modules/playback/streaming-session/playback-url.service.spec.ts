import { ForbiddenException } from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import type { AppConfig } from 'src/config/app-config';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { DEFAULT_MAX_QUALITY, PlaybackUrlService } from './playback-url.service';

const SECRET = 'test-secret';
const SESSION_ID = 'sess-1';
const ASSET_ID = 'asset-1';

const config = {
  apiPublicUrl: 'https://api.example',
  storage: { publicBaseUrl: 'https://cdn.example' },
  playback: { urlSecret: SECRET, urlTtlSeconds: 7200 },
} as unknown as AppConfig;

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  '1080p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
  '720p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
  '360p/index.m3u8',
].join('\n');

const VARIANT = ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4.0,', 'seg_000.ts', '#EXT-X-ENDLIST'].join('\n');

describe('PlaybackUrlService', () => {
  const prisma = {
    streamingSession: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    mediaAsset: { findUnique: jest.fn() },
  };
  const storage = { read: jest.fn() };
  let service: PlaybackUrlService;

  const asset = { id: ASSET_ID, streamUrl: `https://cdn.example/public/hls/${ASSET_ID}/master.m3u8` };
  const token = (overrides = {}) => ({
    sessionId: SESSION_ID,
    exp: 2000000000,
    sig: createHmac('sha256', SECRET).update(`${SESSION_ID}|${ASSET_ID}|2000000000`).digest('hex'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // A fresh instance per test keeps the short playlist cache from leaking between cases.
    service = new PlaybackUrlService(prisma as unknown as PrismaService, storage as unknown as ObjectStorage, config);
    prisma.streamingSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      status: StreamingSessionStatus.ACTIVE,
      userId: 'u-1',
      mediaAssetId: ASSET_ID,
    });
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.mediaAsset.findUnique.mockResolvedValue({ id: ASSET_ID, streamUrl: asset.streamUrl, isSelfHosted: true });
    storage.read.mockImplementation((key: string) => Buffer.from(key.endsWith('master.m3u8') ? MASTER : VARIANT));
  });

  it('signs and verifies a token round-trip', async () => {
    const { exp, sig } = service.sign(SESSION_ID, ASSET_ID);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const { text, maxQuality } = await service.masterPlaylist(SESSION_ID, { sessionId: SESSION_ID, exp, sig });
    expect(maxQuality).toBe(DEFAULT_MAX_QUALITY);
    expect(text).toContain('720p/index.m3u8');
  });

  it('filters renditions above the plan ceiling but keeps unknown ones', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ plan: { features: { maxQuality: '360p' } } });
    const { text } = await service.masterPlaylist(SESSION_ID, token());
    expect(text).toContain('360p/index.m3u8');
    expect(text).not.toContain('720p/index.m3u8');
    expect(text).not.toContain('1080p/index.m3u8');
  });

  it('rewrites variant segments to absolute signed CDN URLs', async () => {
    const text = await service.variantPlaylist(SESSION_ID, '720p', token());
    expect(text).toContain(`https://cdn.example/public/hls/${ASSET_ID}/720p/seg_000.ts?s=${SESSION_ID}&exp=`);
    expect(text).toContain('#EXT-X-ENDLIST');
  });

  it('refuses a rendition above the ceiling (step 14)', async () => {
    await expect(service.variantPlaylist(SESSION_ID, '1080p', token())).rejects.toThrow(ForbiddenException);
  });

  it('caches the master origin read by asset+ceiling and re-signs each caller’s URLs (P2-1)', async () => {
    const otherSession = 'sess-2';
    prisma.streamingSession.findUnique.mockImplementation((args: { where: { id: string } }) =>
      Promise.resolve({
        id: args.where.id,
        status: StreamingSessionStatus.ACTIVE,
        userId: null,
        mediaAssetId: ASSET_ID,
      }),
    );
    const otherToken = {
      sessionId: otherSession,
      exp: 2000000000,
      sig: createHmac('sha256', SECRET).update(`${otherSession}|${ASSET_ID}|2000000000`).digest('hex'),
    };

    const first = await service.masterPlaylist(SESSION_ID, token());
    const second = await service.masterPlaylist(otherSession, otherToken);

    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(first.text).toContain(`?s=${SESSION_ID}&exp=`);
    expect(second.text).toContain(`?s=${otherSession}&exp=`);
    expect(second.text).not.toContain(`?s=${SESSION_ID}&exp=`);
  });

  it('keeps a separate cache entry per ceiling', async () => {
    const uncapped = await service.masterPlaylist(SESSION_ID, token());
    prisma.subscription.findFirst.mockResolvedValue({ plan: { features: { maxQuality: '360p' } } });
    const capped = await service.masterPlaylist(SESSION_ID, token());

    expect(storage.read).toHaveBeenCalledTimes(2);
    expect(uncapped.text).toContain('720p/index.m3u8');
    expect(capped.text).toContain('360p/index.m3u8');
    expect(capped.text).not.toContain('720p/index.m3u8');
  });

  it('shares one origin read across concurrent rendition switches', async () => {
    const [first, second] = await Promise.all([
      service.masterPlaylist(SESSION_ID, token()),
      service.masterPlaylist(SESSION_ID, token()),
    ]);

    expect(storage.read).toHaveBeenCalledTimes(1);
    expect(first.text).toBe(second.text);
  });

  it('serves a repeated rendition from cache instead of re-reading the origin', async () => {
    await service.variantPlaylist(SESSION_ID, '720p', token());
    await service.variantPlaylist(SESSION_ID, '720p', token());

    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it('re-reads the origin after the short cache TTL', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      await service.masterPlaylist(SESSION_ID, token());
      now.mockReturnValue(1_700_000_000_000 + 10_000);
      await service.masterPlaylist(SESSION_ID, token());
      expect(storage.read).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_700_000_000_000 + 15_001);
      await service.masterPlaylist(SESSION_ID, token());
      expect(storage.read).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('evicts a failed origin read so the next request retries', async () => {
    storage.read.mockRejectedValueOnce(new Error('origin down'));

    await expect(service.masterPlaylist(SESSION_ID, token())).rejects.toMatchObject({ name: 'NotFoundException' });
    await expect(service.masterPlaylist(SESSION_ID, token())).resolves.toBeDefined();
    expect(storage.read).toHaveBeenCalledTimes(2);
  });

  it('rejects a tampered signature and an expired token', async () => {
    await expect(service.masterPlaylist(SESSION_ID, token({ sig: `0${token().sig.slice(1)}` }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.masterPlaylist(SESSION_ID, token({ exp: 1000 }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a token for another session and a dead session', async () => {
    await expect(service.masterPlaylist('other', token())).rejects.toMatchObject({ name: 'BadRequestException' });
    prisma.streamingSession.findUnique.mockResolvedValue({ id: SESSION_ID, status: 'ENDED' });
    await expect(service.masterPlaylist(SESSION_ID, token())).rejects.toMatchObject({
      response: expect.objectContaining({ details: expect.objectContaining({ reason: 'SESSION_NOT_ACTIVE' }) }),
    });
  });

  it('falls back to the direct URL when signing is disabled or the asset is external', () => {
    const off = new PlaybackUrlService(prisma as unknown as PrismaService, storage as unknown as ObjectStorage, {
      ...config,
      playback: { urlSecret: undefined, urlTtlSeconds: 7200, sessionRetentionDays: 90 },
    });
    expect(off.masterUrl(SESSION_ID, { id: ASSET_ID, streamUrl: asset.streamUrl, isSelfHosted: true })).toBe(
      asset.streamUrl,
    );
    expect(
      service.masterUrl(SESSION_ID, { id: ASSET_ID, streamUrl: 'https://third.example/m.m3u8', isSelfHosted: false }),
    ).toBe('https://third.example/m.m3u8');
  });

  it('status is ACTIVE-gated, not heartbeat-gated', async () => {
    prisma.streamingSession.findUnique.mockResolvedValue({
      id: SESSION_ID,
      status: StreamingSessionStatus.ACTIVE,
      userId: null,
    });
    await expect(service.masterPlaylist(SESSION_ID, token())).resolves.toBeDefined();
  });
});
