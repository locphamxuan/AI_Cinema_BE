export interface QualityRung {
  /** Rendition folder and API label, e.g. `720p`. */
  name: string;
  /** Output height in pixels; playback compares plan ceilings against it. */
  height: number;
  /** FFmpeg video bitrate. */
  bitrate: string;
}

/**
 * The HLS ladder of LI-02, highest first. The pipeline encodes one rendition per rung and
 * playback maps plan labels and rendition folders back to this same list, so adding a rung
 * (480p, 4K, …) is a single edit here instead of a second one in the playback service.
 */
export const HLS_LADDER: readonly QualityRung[] = [
  { name: '1080p', height: 1080, bitrate: '5000k' },
  { name: '720p', height: 720, bitrate: '2800k' },
  { name: '360p', height: 360, bitrate: '800k' },
];

/** The rung named by a plan label or a rendition URL, e.g. '720p'; undefined when unlisted. */
export function qualityRung(name: string): QualityRung | undefined {
  return HLS_LADDER.find((rung) => rung.name === name);
}
