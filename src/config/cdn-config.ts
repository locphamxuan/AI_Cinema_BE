import type { EnvReader } from './env-reader';

/** Cloudflare's cache-purge endpoint; only overridden by tests. */
const DEFAULT_PURGE_API_URL = 'https://api.cloudflare.com/client/v4';

/**
 * Cloudflare R2 + CDN in front of the HLS output.
 *
 * `baseUrl` is what players resolve segment URLs against: the Cloudflare custom domain routed
 * to the playback Worker. It falls back to STORAGE_PUBLIC_BASE_URL, so a demo with the local
 * driver keeps playing straight from the API origin and the app boots with no CDN set at all.
 *
 * `purge` is optional too: without a zone id and an API token the take-down path logs and
 * carries on, because an episode must come down whether or not the CDN answers.
 */
export interface CdnConfig {
  /** Absolute base URL of the CDN (no trailing slash). Equals the storage base when unset. */
  baseUrl: string;
  /** True once CDN_BASE_URL was set explicitly: the CDN, not the origin, serves the segments. */
  enabled: boolean;
  purge: { apiUrl: string; zoneId?: string; apiToken?: string };
}

export function cdnConfig(read: EnvReader, storagePublicBaseUrl: string): CdnConfig {
  const baseUrl = read.optional('CDN_BASE_URL')?.replace(/\/+$/, '');
  const zoneId = read.optional('CLOUDFLARE_ZONE_ID');
  const apiToken = read.optional('CLOUDFLARE_API_TOKEN');
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    read.errors.push(`CDN_BASE_URL must be an absolute http(s) URL (got "${baseUrl}")`);
  }
  if (Boolean(zoneId) !== Boolean(apiToken)) {
    read.errors.push('CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN must be set together, or both left empty');
  }
  return {
    baseUrl: baseUrl ?? storagePublicBaseUrl,
    enabled: Boolean(baseUrl),
    purge: { apiUrl: read.string('CLOUDFLARE_API_URL', DEFAULT_PURGE_API_URL).replace(/\/+$/, ''), zoneId, apiToken },
  };
}
