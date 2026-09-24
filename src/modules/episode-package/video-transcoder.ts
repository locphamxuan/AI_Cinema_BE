/**
 * Joins the scene clips of an episode into one HLS master playlist with every
 * rendition viewers can pick (LI-02). A real adapter (e.g. a cloud transcoding
 * service) replaces MockVideoTranscoder without touching EpisodePackageService.
 */
export interface SceneClip {
  storageKey: string;
  durationSeconds: number;
}

export interface TranscodedCut {
  streamUrl: string;
  qualities: string[];
  durationSeconds: number;
}

export interface VideoTranscoder {
  transcode(clips: SceneClip[]): Promise<TranscodedCut>;
}

export const VIDEO_TRANSCODER = 'VIDEO_TRANSCODER';

// Renditions every published episode is encoded in, lowest first.
export const STREAM_QUALITIES = ['360p', '720p', '1080p'];

/** Dev/test stand-in: serves the first clip's playlist as the master and reports the standard ladder. */
export class MockVideoTranscoder implements VideoTranscoder {
  transcode(clips: SceneClip[]): Promise<TranscodedCut> {
    return Promise.resolve({
      streamUrl: clips[0].storageKey,
      qualities: STREAM_QUALITIES,
      durationSeconds: clips.reduce((sum, clip) => sum + clip.durationSeconds, 0),
    });
  }
}
