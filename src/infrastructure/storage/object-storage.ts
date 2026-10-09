import type { Readable } from 'node:stream';

/**
 * Public objects (HLS renditions, artwork, subtitles) are served to players from
 * STORAGE_PUBLIC_BASE_URL. Private objects (idea files, briefs, original uploads) have no
 * URL: the API streams them after checking the caller may read them.
 */
export type Visibility = 'public' | 'private';

export abstract class ObjectStorage {
  abstract putBuffer(key: string, body: Buffer, contentType: string, visibility: Visibility): Promise<void>;

  abstract putFile(key: string, localPath: string, contentType: string, visibility: Visibility): Promise<void>;

  abstract read(key: string, visibility: Visibility): Promise<Buffer>;

  abstract stream(key: string, visibility: Visibility): Promise<Readable>;

  /** Deletes an object; a missing one is not an error. */
  abstract remove(key: string, visibility: Visibility): Promise<void>;

  /** Where players load a public object from. */
  abstract publicUrl(key: string): string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function contentTypeOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return MIME_BY_EXTENSION[dot >= 0 ? fileName.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
}

/** Keeps object keys free of path tricks: only safe characters, no "..", no leading slash. */
export function assertSafeKey(key: string): void {
  if (!/^[\w./-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Unsafe storage key "${key}"`);
  }
}
