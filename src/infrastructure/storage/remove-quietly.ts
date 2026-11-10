import { Logger } from '@nestjs/common';
import type { ObjectStorage, Visibility } from './object-storage';

const logger = new Logger('StorageCleanup');

/**
 * Best-effort removal of an object nothing points at any more. A failure must not undo or fail the
 * request that triggered it, but it leaves an orphan behind, so the key and the reason are logged.
 */
export async function removeQuietly(
  storage: Pick<ObjectStorage, 'remove'>,
  key: string,
  visibility: Visibility,
): Promise<void> {
  try {
    await storage.remove(key, visibility);
  } catch (error) {
    logger.warn(`Could not remove ${visibility} object ${key}: ${(error as Error).message}`);
  }
}
