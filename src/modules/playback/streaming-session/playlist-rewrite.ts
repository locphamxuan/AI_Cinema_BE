import { parseMasterPlaylist } from 'src/modules/production/media-ingest/hls/hls-playlist';

/** One `#EXT-X-STREAM-INF` entry of a master playlist that the plan may see. */
export interface MasterVariant {
  /** The raw `#EXT-X-STREAM-INF` line, kept byte-for-byte. */
  tag: string;
  /** Rendition folder, e.g. `720p`; the API variant route takes it as the quality. */
  folder: string;
}

export interface PlaylistUri {
  /** Object path relative to the asset folder, e.g. `720p/seg_000.ts`. */
  path: string;
  /** Query exactly as written, e.g. `?token=abc`; empty when the playlist had none. */
  search: string;
}

/** A rendition playlist line, ready to be signed per request. */
export type VariantLine =
  | { kind: 'raw'; line: string }
  | { kind: 'segment'; uri: PlaylistUri }
  /** A URI-bearing tag such as `#EXT-X-MAP`; the signed URL replaces the placeholder at render time. */
  | { kind: 'tag'; prefix: string; suffix: string; uri: PlaylistUri };

/** HLS master playlist (`.m3u8`, query string allowed), as opposed to a progressive MP4. */
export function isHlsPlaylist(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url);
}

/** Parses a master playlist and keeps every rendition at or below the pixel ceiling. */
export function selectVariants(raw: string, streamUrl: string, ceiling: number): MasterVariant[] {
  const heightByUri = new Map(parseMasterPlaylist(raw, streamUrl).map((variant) => [variant.uri, variant.height]));
  const allowed: MasterVariant[] = [];
  const rawLines = raw.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const tag = rawLines[i].trim();
    if (!tag.startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = (rawLines[i + 1] ?? '').trim();
    if (!uri || uri.startsWith('#')) continue;
    const absolute = new URL(uri, streamUrl).toString();
    const height = heightByUri.get(absolute) ?? null;
    // Renditions without RESOLUTION stay (never strip the only way to play); known ones filter by ceiling.
    if (height !== null && height > ceiling) continue;
    allowed.push({ tag: rawLines[i], folder: folderOf(absolute) });
  }
  return allowed;
}

/**
 * Splits a rendition playlist into lines ready for per-request signing. URIs are resolved against
 * the playlist so query strings and sub-folders survive, and the fMP4 `#EXT-X-MAP` init segment is
 * rewritten like a segment instead of leaking a relative URL. Throws on a malformed URL.
 */
export function variantLines(raw: string, folder: string, streamUrl: string): VariantLine[] {
  const playlistUrl = new URL(`${folder}/index.m3u8`, streamUrl);
  const assetRoot = new URL('.', streamUrl);
  const uriOf = (uri: string): PlaylistUri | null => {
    const resolved = new URL(uri, playlistUrl);
    // Only objects under this asset are ours to sign; anything else stays exactly as written.
    if (resolved.origin !== assetRoot.origin || !resolved.pathname.startsWith(assetRoot.pathname)) return null;
    return { path: resolved.pathname.slice(assetRoot.pathname.length), search: resolved.search };
  };
  return raw.split('\n').map((line): VariantLine => {
    const trimmed = line.trim();
    if (!trimmed) return { kind: 'raw', line };
    if (trimmed.startsWith('#')) return mapUriTag(line, uriOf);
    const uri = uriOf(trimmed);
    return uri ? { kind: 'segment', uri } : { kind: 'raw', line };
  });
}

/** Last path segment's folder, e.g. `.../720p/index.m3u8` -> `720p`. */
function folderOf(uri: string): string {
  const parts = new URL(uri).pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'source';
}

/**
 * P2-8: rewrites the URI attribute of `#EXT-X-MAP` (the fMP4 init segment), keeping any
 * BYTERANGE and the rest of the tag intact. Other tags stay raw so signing never mangles
 * something that is not a media object of this asset.
 */
function mapUriTag(line: string, uriOf: (uri: string) => PlaylistUri | null): VariantLine {
  const tagStart = line.indexOf('#');
  if (tagStart < 0) return { kind: 'raw', line };
  const tag = line.slice(tagStart);
  if (!tag.startsWith('#EXT-X-MAP:')) return { kind: 'raw', line };
  const match = /URI=("[^"]*"|[^,]*)/.exec(tag);
  if (!match) return { kind: 'raw', line };
  const value = match[1];
  const quoted = value.startsWith('"');
  const uri = uriOf(quoted ? value.slice(1, -1) : value);
  if (!uri) return { kind: 'raw', line };
  const valueStart = tagStart + match.index + 'URI='.length;
  return {
    kind: 'tag',
    prefix: line.slice(0, valueStart + (quoted ? 1 : 0)),
    suffix: line.slice(valueStart + value.length - (quoted ? 1 : 0)),
    uri,
  };
}
