import { HLS_LADDER, qualityRung } from 'src/modules/production/media-ingest/hls/quality-ladder';

/** Guests and plan-less members cap here; a plan may raise it via features.maxQuality. */
export const DEFAULT_MAX_QUALITY = '720p';

/**
 * Ceiling label, e.g. '720p', read off the member's plan features (running plan or Free plan)
 * when the session is opened; guests and unknown labels get the default. P2-7: labels come from
 * the pipeline's ladder, so a newly encoded rendition is allowed here too.
 */
export function maxQualityOf(features: unknown): string {
  const value = features && typeof features === 'object' ? (features as { maxQuality?: unknown }).maxQuality : null;
  return typeof value === 'string' && qualityRung(value) ? value : DEFAULT_MAX_QUALITY;
}

/** Pixel ceiling of a plan label; the default keeps an unknown or removed label from locking playback. */
export function qualityCeiling(maxQuality: string): number {
  return (qualityRung(maxQuality) ?? qualityRung(DEFAULT_MAX_QUALITY) ?? HLS_LADDER[HLS_LADDER.length - 1]).height;
}
