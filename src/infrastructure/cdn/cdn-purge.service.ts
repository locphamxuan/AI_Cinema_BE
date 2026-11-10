import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

/** Cloudflare answers a purge within seconds; nothing here is worth waiting longer for. */
const PURGE_TIMEOUT_MS = 5_000;

export interface PurgeOutcome {
  /** False when purging is not configured, or when Cloudflare refused the request. */
  purged: boolean;
  /** Why it was skipped or refused, for the log and the tests. */
  reason?: string;
}

/**
 * Drops an asset's HLS objects from the Cloudflare edge cache when an episode is taken down.
 *
 * Segments are stored `immutable` for a year, so without a purge a taken-down episode could
 * keep playing from the edge for whoever still holds an unexpired signed URL. The purge closes
 * that window at once; the signed-URL expiry (PLAYBACK_URL_TTL_SECONDS, one hour by default)
 * is the guarantee that remains when no Cloudflare token is configured.
 *
 * Purging is best effort on purpose: a take-down is a compliance action and must never fail
 * because the CDN API is down. Every failure is logged and reported, never thrown.
 */
@Injectable()
export class CdnPurgeService {
  private readonly logger = new Logger(CdnPurgeService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  configured(): boolean {
    const { zoneId, apiToken } = this.config.cdn.purge;
    return Boolean(zoneId && apiToken);
  }

  /** Purges every playlist and segment of one media asset. */
  async purgeAsset(assetId: string): Promise<PurgeOutcome> {
    return this.purgePrefix(`${this.prefixHost()}/public/hls/${assetId}/`);
  }

  private async purgePrefix(prefix: string): Promise<PurgeOutcome> {
    const { apiUrl, zoneId, apiToken } = this.config.cdn.purge;
    if (!zoneId || !apiToken) {
      this.logger.log(`CDN purge skipped for ${prefix}: CLOUDFLARE_ZONE_ID/CLOUDFLARE_API_TOKEN are not set`);
      return { purged: false, reason: 'PURGE_NOT_CONFIGURED' };
    }
    try {
      const response = await fetch(`${apiUrl}/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [prefix] }),
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.error(`CDN purge for ${prefix} was refused with HTTP ${response.status}`);
        return { purged: false, reason: `PURGE_HTTP_${response.status}` };
      }
      this.logger.log(`CDN purge requested for ${prefix}`);
      return { purged: true };
    } catch (error) {
      // A take-down must not depend on Cloudflare being reachable: log and let the caller carry on.
      this.logger.error(
        `CDN purge for ${prefix} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { purged: false, reason: 'PURGE_REQUEST_FAILED' };
    }
  }

  /** Cloudflare's prefix purge takes host + path, never a scheme. */
  private prefixHost(): string {
    return this.config.cdn.baseUrl.replace(/^https?:\/\//, '');
  }
}
