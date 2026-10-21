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
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { runningPlanWhere } from 'src/modules/episode-access/subscription/running-plan';
import { parseMasterPlaylist } from 'src/modules/production/media-ingest/hls/hls-playlist';

/** Guests and plan-less members cap here; a plan may raise it via features.maxQuality. */
export const DEFAULT_MAX_QUALITY = '720p';

const HEIGHT_BY_QUALITY: Record<string, number> = { '360p': 360, '720p': 720, '1080p': 1080 };

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

interface CachedMasterVariant {
  /** The raw `#EXT-X-STREAM-INF` line, kept byte-for-byte. */
  tag: string;
  /** Rendition folder, e.g. `720p`; the API variant route takes it as the quality. */
  folder: string;
}

type CachedVariantLine = { raw: string } | { segment: string };

export interface PlaybackToken {
  sessionId: string;
  exp: number;
  sig: string;
}

/**
 * Phase 2: signed playback URLs plus server-side rendition filtering.
 *
 * Token: `?s=<sessionId>&exp=<unix>&sig=HMAC(secret, sessionId|assetId|exp)`.
 * The signature binds the session, not the path, so one token opens the master,
 * the variant playlists and every segment of that asset until `exp`. The edge
 * Worker verifies the same token before MinIO is touched; the API re-checks the
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

  /** Absolute master URL for `POST /sessions`; direct origin URL when signing is off or external. */
  masterUrl(sessionId: string, asset: { id: string; streamUrl: string; isSelfHosted: boolean }): string {
    if (!asset.isSelfHosted || !this.enabled()) return asset.streamUrl;
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
    return { exp, sig: this.hmac(secret, sessionId, assetId, exp) };
  }

  /** Master playlist with only renditions at or below the caller's ceiling. */
  async masterPlaylist(sessionId: string, token: PlaybackToken): Promise<{ text: string; maxQuality: string }> {
    const { session, asset } = await this.assertToken(sessionId, token);
    const maxQuality = await this.maxQualityOf(session.userId);
    const ceiling = HEIGHT_BY_QUALITY[maxQuality] ?? HEIGHT_BY_QUALITY[DEFAULT_MAX_QUALITY];
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
    const maxQuality = await this.maxQualityOf(session.userId);
    const ceiling = HEIGHT_BY_QUALITY[maxQuality] ?? HEIGHT_BY_QUALITY[DEFAULT_MAX_QUALITY];
    const wanted = HEIGHT_BY_QUALITY[quality];
    if (!wanted || wanted > ceiling) {
      throw new ForbiddenException({
        message: 'This rendition is not allowed for this plan',
        details: { reason: 'QUALITY_NOT_ALLOWED', maxQuality },
      });
    }
    const folder = `${wanted}p`;
    const lines = await this.cached(`variant:${asset.id}:${folder}`, () => this.readVariant(asset, folder));
    // Sliding expiry: segments are re-signed on every media-playlist load.
    const signed = { sessionId, ...this.sign(sessionId, asset.id) };
    return lines.map((line) => ('segment' in line ? this.cdnUrl(asset.id, line.segment, signed) : line.raw)).join('\n');
  }

  /** Reads the origin once per (asset, ceiling) and keeps only the variants the plan may see. */
  private async readMaster(asset: PlayableAsset, ceiling: number): Promise<CachedMasterVariant[]> {
    const raw = await this.readText(`hls/${asset.id}/master.m3u8`, asset.streamUrl);
    try {
      return this.selectVariants(raw, asset, ceiling);
    } catch (error) {
      // P2-6: a corrupt playlist is an origin/transcode fault, not a bad request and not a 500.
      // Log the parse error, then answer 502 so the player and ops see a broken upstream.
      this.logger.error(
        `Invalid master playlist hls/${asset.id}/master.m3u8: ${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        message: 'The master playlist is invalid',
        details: { reason: 'MEDIA_PLAYLIST_INVALID' },
      });
    }
  }

  /** Parses a master playlist and keeps every rendition at or below the plan ceiling. */
  private selectVariants(raw: string, asset: PlayableAsset, ceiling: number): CachedMasterVariant[] {
    const heightByUri = new Map(
      parseMasterPlaylist(raw, asset.streamUrl).map((variant) => [variant.uri, variant.height]),
    );
    const allowed: CachedMasterVariant[] = [];
    const rawLines = raw.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      const tag = rawLines[i].trim();
      if (!tag.startsWith('#EXT-X-STREAM-INF')) continue;
      const uri = (rawLines[i + 1] ?? '').trim();
      if (!uri || uri.startsWith('#')) continue;
      const absolute = new URL(uri, asset.streamUrl).toString();
      const height = heightByUri.get(absolute) ?? null;
      // Renditions without RESOLUTION stay (never strip the only way to play); known ones filter by ceiling.
      if (height !== null && height > ceiling) continue;
      allowed.push({ tag: rawLines[i], folder: folderOf(absolute) });
    }
    return allowed;
  }

  /** Reads the origin once per (asset, rendition) and keeps each line ready for per-request signing. */
  private async readVariant(asset: PlayableAsset, folder: string): Promise<CachedVariantLine[]> {
    const raw = await this.readText(`hls/${asset.id}/${folder}/index.m3u8`, asset.streamUrl);
    return raw.split('\n').map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return { raw: line };
      const file = trimmed.split('/').pop()!;
      return { segment: `${folder}/${file}` };
    });
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

  /** Ceiling label, e.g. '720p': the running plan's features.maxQuality, else the default. */
  async maxQualityOf(userId: string | null): Promise<string> {
    if (!userId) return DEFAULT_MAX_QUALITY;
    const plan = await this.prisma.subscription.findFirst({
      where: runningPlanWhere(userId),
      orderBy: { currentPeriodEnd: 'desc' },
      select: { plan: { select: { features: true } } },
    });
    const features = plan?.plan.features as { maxQuality?: unknown } | null;
    const value = features?.maxQuality;
    return typeof value === 'string' && HEIGHT_BY_QUALITY[value] ? value : DEFAULT_MAX_QUALITY;
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
      select: { userId: true, status: true, mediaAssetId: true },
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
    this.verify(token, asset.id);
    return { session, asset: { id: asset.id, streamUrl } };
  }

  private verify(token: PlaybackToken, assetId: string): void {
    const secret = this.config.playback.urlSecret;
    if (!secret) {
      throw new UnprocessableEntityException({
        message: 'Signed playback is not configured',
        details: { reason: 'PLAYBACK_SIGNING_DISABLED' },
      });
    }
    if (!Number.isInteger(token.exp) || !/^[0-9a-f]{64}$/i.test(token.sig)) {
      throw new BadRequestException({
        message: 'The playback token is malformed',
        details: { reason: 'PLAYBACK_TOKEN_INVALID' },
      });
    }
    if (token.exp * 1000 <= Date.now()) {
      throw new ForbiddenException({
        message: 'The playback token has expired',
        details: { reason: 'PLAYBACK_TOKEN_EXPIRED' },
      });
    }
    const expected = this.hmac(secret, token.sessionId, assetId, token.exp);
    if (
      expected.length !== token.sig.length ||
      !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token.sig.toLowerCase(), 'hex'))
    ) {
      throw new ForbiddenException({
        message: 'The playback token signature is invalid',
        details: { reason: 'PLAYBACK_TOKEN_INVALID' },
      });
    }
  }

  private hmac(secret: string, sessionId: string, assetId: string, exp: number): string {
    return createHmac('sha256', secret).update(`${sessionId}|${assetId}|${exp}`).digest('hex');
  }

  /** API-issued variant URL: its response is where segment URLs receive a fresh expiry. */
  private variantUrl(sessionId: string, quality: string, token: PlaybackToken): string {
    return `${this.config.apiPublicUrl}/api/playback/s/${sessionId}/renditions/${quality}/index.m3u8?s=${token.sessionId}&exp=${token.exp}&sig=${token.sig}`;
  }

  private cdnUrl(assetId: string, path: string, token: PlaybackToken): string {
    const base = this.config.storage.publicBaseUrl;
    return `${base}/public/hls/${assetId}/${path}?s=${token.sessionId}&exp=${token.exp}&sig=${token.sig}`;
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

/** Last path segment's folder, e.g. `.../720p/index.m3u8` -> `720p`. */
function folderOf(uri: string): string {
  const parts = new URL(uri).pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'source';
}
