import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StreamingSessionStatus } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { qualityRung } from 'src/common/hls/quality-ladder';
import { DEFAULT_MAX_QUALITY, qualityCeiling } from './playback-quality';
import { assertPlaybackToken, playbackSignature, type PlaybackToken } from './playback-token';
import {
  isHlsPlaylist,
  selectVariants,
  variantLines,
  type MasterVariant,
  type PlaylistUri,
  type VariantLine,
} from './playlist-rewrite';

/**
 * P2-1: ABR switches re-read the same origin playlist on every rendition change. Cache the
 * parsed/rewritten shape for a few seconds — the token and session are still checked on every
 * request and the signed query is rebuilt per request, so one viewer's token never leaks to another.
 */
const PLAYLIST_CACHE_TTL_MS = 15_000;
const PLAYLIST_CACHE_MAX_ENTRIES = 500;

interface PlayableAsset {
  id: string;
  streamUrl: string;
}

/**
 * Phase 2: signed playback URLs plus server-side rendition filtering.
 *
 * Token: `?s=<sessionId>&exp=<unix>&sig=HMAC(secret, sessionId|assetId|exp)`.
 * The signature binds the session, not the path, so one token opens the master,
 * the variant playlists and every segment of that asset until `exp`. The edge
 * Worker verifies the same token before the R2 bucket is touched; the API re-checks the
 * session row on the playlist endpoints (cheap text responses, not segments).
 *
 * P2-2: `exp` is short (default 1h) and every playlist response re-signs its child
 * URLs, so an active viewer slides forward while a leaked link dies within the TTL.
 */
@Injectable()
export class PlaybackUrlService {
  private readonly logger = new Logger(PlaybackUrlService.name);
  private readonly playlistCache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  enabled(): boolean {
    return Boolean(this.config.playback.urlSecret);
  }

  /**
   * Absolute master URL for `POST /sessions`; direct origin URL when signing is off, the asset is
   * external, or the stream is a progressive file (an MP4 has no `hls/<asset>/` playlists to sign).
   */
  masterUrl(sessionId: string, asset: { id: string; streamUrl: string; isSelfHosted: boolean }): string {
    if (!asset.isSelfHosted || !this.enabled() || !isHlsPlaylist(asset.streamUrl)) return asset.streamUrl;
    const { exp, sig } = this.sign(sessionId, asset.id);
    return `${this.config.apiPublicUrl}/api/playback/s/${sessionId}/master.m3u8?s=${sessionId}&exp=${exp}&sig=${sig}`;
  }

  sign(sessionId: string, assetId: string): { exp: number; sig: string } {
    const secret = this.config.playback.urlSecret;
    if (!secret) {
      throw new UnprocessableEntityException({
        message: 'Signed playback is not configured',
        details: { reason: 'PLAYBACK_SIGNING_DISABLED' },
      });
    }
    const exp = Math.floor(Date.now() / 1000) + this.config.playback.urlTtlSeconds;
    return { exp, sig: playbackSignature(secret, sessionId, assetId, exp) };
  }

  /** Master playlist with only renditions at or below the caller's ceiling. */
  async masterPlaylist(sessionId: string, token: PlaybackToken): Promise<{ text: string; maxQuality: string }> {
    const { session, asset } = await this.assertToken(sessionId, token);
    const maxQuality = session.maxQuality ?? DEFAULT_MAX_QUALITY;
    const ceiling = qualityCeiling(maxQuality);
    const variants = await this.cached(`master:${asset.id}:${ceiling}`, () => this.readMaster(asset, ceiling));
    if (variants.length === 0) {
      throw new ForbiddenException({
        message: 'No rendition is allowed for this plan',
        details: { reason: 'QUALITY_NOT_ALLOWED', maxQuality },
      });
    }
    // Sliding expiry: the incoming token only gates this request; children get a fresh one.
    const signed = { sessionId, ...this.sign(sessionId, asset.id) };
    const lines = ['#EXTM3U'];
    for (const variant of variants) {
      // Variants go through the API so each serve re-checks the session and re-signs segments.
      lines.push(variant.tag, this.variantUrl(sessionId, variant.folder, signed));
    }
    return { text: lines.join('\n'), maxQuality };
  }

  /** Variant playlist with every segment rewritten to an absolute signed CDN URL. */
  async variantPlaylist(sessionId: string, quality: string, token: PlaybackToken): Promise<string> {
    const { session, asset } = await this.assertToken(sessionId, token);
    const maxQuality = session.maxQuality ?? DEFAULT_MAX_QUALITY;
    const ceiling = qualityCeiling(maxQuality);
    const rung = qualityRung(quality);
    if (!rung || rung.height > ceiling) {
      throw new ForbiddenException({
        message: 'This rendition is not allowed for this plan',
        details: { reason: 'QUALITY_NOT_ALLOWED', maxQuality },
      });
    }
    const folder = rung.name;
    const lines = await this.cached(`variant:${asset.id}:${folder}`, () => this.readVariant(asset, folder));
    // Sliding expiry: segments are re-signed on every media-playlist load.
    const signed = { sessionId, ...this.sign(sessionId, asset.id) };
    return lines
      .map((line) => {
        switch (line.kind) {
          case 'raw':
            return line.line;
          case 'segment':
            return this.cdnUrl(asset.id, line.uri, signed);
          case 'tag':
            return `${line.prefix}${this.cdnUrl(asset.id, line.uri, signed)}${line.suffix}`;
        }
      })
      .join('\n');
  }

  /** Reads the origin once per (asset, ceiling) and keeps only the variants the plan may see. */
  private async readMaster(asset: PlayableAsset, ceiling: number): Promise<MasterVariant[]> {
    const raw = await this.readText(`hls/${asset.id}/master.m3u8`, asset.streamUrl);
    try {
      return selectVariants(raw, asset.streamUrl, ceiling);
    } catch (error) {
      // P2-6: a corrupt playlist is an origin/transcode fault, not a bad request and not a 500.
      // Log the parse error, then answer 502 so the player and ops see a broken upstream.
      return this.invalidPlaylist(`hls/${asset.id}/master.m3u8`, 'The master playlist is invalid', error);
    }
  }

  /** Reads the origin once per (asset, rendition) and keeps each line ready for per-request signing. */
  private async readVariant(asset: PlayableAsset, folder: string): Promise<VariantLine[]> {
    const key = `hls/${asset.id}/${folder}/index.m3u8`;
    const raw = await this.readText(key, asset.streamUrl);
    try {
      return variantLines(raw, folder, asset.streamUrl);
    } catch (error) {
      // Same contract as the master: a malformed rendition playlist is a bad upstream, not a 500.
      return this.invalidPlaylist(key, 'The rendition playlist is invalid', error);
    }
  }

  /**
   * Short-lived cache keyed by (assetId, ceiling/rendition). In-flight reads share one promise so a
   * burst of ABR switches does not stampede the origin; failures are evicted so the next request retries.
   */
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.playlistCache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    const value = load();
    this.playlistCache.set(key, { expiresAt: now + PLAYLIST_CACHE_TTL_MS, value });
    void value.catch(() => {
      if (this.playlistCache.get(key)?.value === value) this.playlistCache.delete(key);
    });
    this.pruneCache(now);
    return value;
  }

  private pruneCache(now: number): void {
    if (this.playlistCache.size <= PLAYLIST_CACHE_MAX_ENTRIES) return;
    for (const [key, entry] of this.playlistCache) {
      if (entry.expiresAt <= now) this.playlistCache.delete(key);
    }
    // Still full of fresh entries: drop the oldest insertions so memory stays bounded.
    const overflow = this.playlistCache.size - PLAYLIST_CACHE_MAX_ENTRIES;
    let removed = 0;
    for (const key of this.playlistCache.keys()) {
      if (removed === overflow) break;
      this.playlistCache.delete(key);
      removed++;
    }
  }

  private async assertToken(sessionId: string, token: PlaybackToken) {
    if (token.sessionId !== sessionId) {
      throw new BadRequestException({
        message: 'The token does not belong to this session',
        details: { reason: 'PLAYBACK_TOKEN_INVALID' },
      });
    }
    const session = await this.prisma.streamingSession.findUnique({
      where: { id: sessionId },
      select: { status: true, mediaAssetId: true, maxQuality: true },
    });
    if (!session || session.status !== StreamingSessionStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'The streaming session is no longer active',
        details: { reason: 'SESSION_NOT_ACTIVE' },
      });
    }
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: session.mediaAssetId },
      select: { id: true, streamUrl: true, isSelfHosted: true },
    });
    if (!asset?.streamUrl || !asset.isSelfHosted) {
      throw new NotFoundException({
        message: 'The episode has no playable stream',
        details: { reason: 'MEDIA_NOT_READY' },
      });
    }
    const streamUrl: string = asset.streamUrl;
    assertPlaybackToken(token, asset.id, this.config.playback.urlSecret);
    return { session, asset: { id: asset.id, streamUrl } };
  }

  /** API-issued variant URL: its response is where segment URLs receive a fresh expiry. */
  private variantUrl(sessionId: string, quality: string, token: PlaybackToken): string {
    return `${this.config.apiPublicUrl}/api/playback/s/${sessionId}/renditions/${quality}/index.m3u8?s=${token.sessionId}&exp=${token.exp}&sig=${token.sig}`;
  }

  private cdnUrl(assetId: string, uri: PlaylistUri, token: PlaybackToken): string {
    // CDN_BASE_URL when a Cloudflare custom domain fronts the bucket, the storage origin otherwise,
    // so a local demo keeps serving the same signed paths straight from the API's /media mount.
    const base = this.config.cdn.baseUrl;
    // Keep the playlist's own query; ours joins it instead of starting a second one.
    const separator = uri.search ? '&' : '?';
    return `${base}/public/hls/${assetId}/${uri.path}${uri.search}${separator}s=${token.sessionId}&exp=${token.exp}&sig=${token.sig}`;
  }

  /** Logs a playlist parse failure and answers 502: the object exists but cannot be played. */
  private invalidPlaylist(key: string, message: string, error: unknown): never {
    this.logger.error(
      `Invalid playlist ${key}: ${describeError(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    throw new BadGatewayException({
      message,
      details: { reason: 'MEDIA_PLAYLIST_INVALID' },
    });
  }

  private async readText(key: string, streamUrl: string): Promise<string> {
    try {
      return (await this.storage.read(key, 'public')).toString('utf8');
    } catch (error) {
      // P2-5: keep the origin failure visible. A wrong bucket, revoked credentials or a timeout
      // is not "media not ready", and mapping it to 404 without this line leaves ops blind.
      this.logger.error(
        `Failed to read playlist ${key} from origin: ${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new NotFoundException({
        message: 'The playlist is not ready yet',
        details: { reason: 'MEDIA_NOT_READY', streamUrl },
      });
    }
  }
}

/** Error name plus the S3 error code / HTTP status when present, so logs separate 404, 403/5xx and bad playlists. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { code, $metadata } = error as { code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const parts = [error.name];
  if (typeof code === 'string' || typeof code === 'number') parts.push(`code=${code}`);
  if (typeof $metadata?.httpStatusCode === 'number') parts.push(`http=${$metadata.httpStatusCode}`);
  return `${parts.join(' ')}: ${error.message}`;
}
