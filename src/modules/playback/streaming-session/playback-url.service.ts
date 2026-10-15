import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
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
 */
@Injectable()
export class PlaybackUrlService {
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
    const raw = await this.readText(`hls/${asset.id}/master.m3u8`, asset.streamUrl);
    const variants = parseMasterPlaylist(raw, asset.streamUrl);
    const ceiling = HEIGHT_BY_QUALITY[maxQuality] ?? HEIGHT_BY_QUALITY[DEFAULT_MAX_QUALITY];
    const heightByUri = new Map(variants.map((variant) => [variant.uri, variant.height]));
    const lines = ['#EXTM3U'];
    const rawLines = raw.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      const tag = rawLines[i].trim();
      if (!tag.startsWith('#EXT-X-STREAM-INF')) continue;
      const uri = (rawLines[i + 1] ?? '').trim();
      if (!uri || uri.startsWith('#')) continue;
      const height = heightByUri.get(new URL(uri, asset.streamUrl).toString()) ?? null;
      // Renditions without RESOLUTION stay (never strip the only way to play); known ones filter by ceiling.
      if (height !== null && height > ceiling) continue;
      lines.push(
        rawLines[i],
        this.cdnUrl(asset.id, `${folderOf(new URL(uri, asset.streamUrl).toString())}/index.m3u8`, token),
      );
    }
    if (lines.length === 1) {
      throw new ForbiddenException({
        message: 'No rendition is allowed for this plan',
        details: { reason: 'QUALITY_NOT_ALLOWED', maxQuality },
      });
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
    const raw = await this.readText(`hls/${asset.id}/${folder}/index.m3u8`, asset.streamUrl);
    return raw
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const file = trimmed.split('/').pop()!;
        return this.cdnUrl(asset.id, `${folder}/${file}`, token);
      })
      .join('\n');
  }

  /** Ceiling label, e.g. '720p': the running plan's features.maxQuality, else the default. */
  async maxQualityOf(userId: string | null): Promise<string> {
    if (!userId) return DEFAULT_MAX_QUALITY;
    const plan = await this.prisma.subscription.findFirst({
      where: runningPlanWhere(userId),
      orderBy: { currentPeriodEnd: 'desc' },
      include: { plan: { select: { features: true } } },
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
    const session = await this.prisma.streamingSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== StreamingSessionStatus.ACTIVE) {
      throw new ForbiddenException({
        message: 'The streaming session is no longer active',
        details: { reason: 'SESSION_NOT_ACTIVE' },
      });
    }
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: session.mediaAssetId } });
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

  private cdnUrl(assetId: string, path: string, token: PlaybackToken): string {
    const base = this.config.storage.publicBaseUrl;
    return `${base}/public/hls/${assetId}/${path}?s=${token.sessionId}&exp=${token.exp}&sig=${token.sig}`;
  }

  private async readText(key: string, streamUrl: string): Promise<string> {
    try {
      return (await this.storage.read(key, 'public')).toString('utf8');
    } catch {
      throw new NotFoundException({
        message: 'The playlist is not ready yet',
        details: { reason: 'MEDIA_NOT_READY', streamUrl },
      });
    }
  }
}

/** Last path segment's folder, e.g. `.../720p/index.m3u8` -> `720p`. */
function folderOf(uri: string): string {
  const parts = new URL(uri).pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'source';
}
