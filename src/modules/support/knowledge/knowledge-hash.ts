import { createHash } from 'node:crypto';

/** The manifest that decides whether a published article needs to be embedded again. */
export function hashContent(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

export function chunkHash(model: string, content: string): string {
  return createHash('sha256').update(`${model}\u0000${content}`, 'utf8').digest('hex');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
