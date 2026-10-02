import { fetchText, UnsafeUrlError, type UrlPolicy } from './safe-url';

export interface HlsVariant {
  uri: string;
  /** Height from RESOLUTION, when the playlist gives it. */
  height: number | null;
  bandwidth: number;
}

export interface ProbedHls {
  /** e.g. ['360p', '720p'], lowest first; ['source'] when the playlist does not tell. */
  qualities: string[];
  durationSeconds: number;
}

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|,|:)${name}=("[^"]*"|[^,]*)`).exec(tag)?.[1]?.replace(/^"|"$/g, '');
}

/** Variant streams of a master playlist; empty when `text` is a media playlist. */
export function parseMasterPlaylist(text: string, baseUrl: string): HlsVariant[] {
  const all = lines(text);
  if (all[0] !== '#EXTM3U') throw new UnsafeUrlError('The link is not an HLS playlist (#EXTM3U missing)');
  const variants: HlsVariant[] = [];
  all.forEach((line, i) => {
    if (!line.startsWith('#EXT-X-STREAM-INF')) return;
    const uri = all[i + 1];
    if (!uri || uri.startsWith('#')) return;
    const resolution = attribute(line, 'RESOLUTION');
    variants.push({
      uri: new URL(uri, baseUrl).toString(),
      height: resolution ? Number(resolution.split('x')[1]) || null : null,
      bandwidth: Number(attribute(line, 'BANDWIDTH')) || 0,
    });
  });
  return variants;
}

/** Total length of a VOD media playlist; live playlists (no #EXT-X-ENDLIST) are refused. */
export function mediaPlaylistDuration(text: string): number {
  const all = lines(text);
  if (all[0] !== '#EXTM3U') throw new UnsafeUrlError('The rendition is not an HLS playlist');
  if (!all.includes('#EXT-X-ENDLIST')) {
    throw new UnsafeUrlError('The playlist is live or unfinished (#EXT-X-ENDLIST missing); only VOD can be published');
  }
  const total = all
    .filter((line) => line.startsWith('#EXTINF:'))
    .reduce((sum, line) => sum + (Number.parseFloat(line.slice('#EXTINF:'.length)) || 0), 0);
  if (total <= 0) throw new UnsafeUrlError('The playlist has no segment');
  return Math.round(total);
}

/**
 * BR-17: the playlist is reachable, has at least one rendition and a readable duration. Every
 * playlist is fetched through the SSRF policy, so variants cannot point inside the network.
 */
export async function probeHls(masterUrl: string, policy: UrlPolicy): Promise<ProbedHls> {
  const master = await fetchText(masterUrl, policy);
  const variants = parseMasterPlaylist(master, masterUrl);
  if (!variants.length) {
    return { qualities: ['source'], durationSeconds: mediaPlaylistDuration(master) };
  }
  // The lowest rendition is the cheapest one to read; every rendition has the same length.
  const sorted = [...variants].sort((a, b) => (a.height ?? a.bandwidth) - (b.height ?? b.bandwidth));
  const durationSeconds = mediaPlaylistDuration(await fetchText(sorted[0].uri, policy));
  const heights = [...new Set(sorted.map((v) => v.height).filter((h): h is number => h !== null))];
  return { qualities: heights.length ? heights.map((h) => `${h}p`) : ['source'], durationSeconds };
}
