import { mkdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '@nestjs/common';
import type { MediaProcessor } from 'src/infrastructure/media/media-processor';
import { isWebVtt, planSubtitles, type SubtitleStream } from 'src/infrastructure/media/subtitle-streams';
import { contentTypeOf, type ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { ReadySubtitle } from './media-outcome.service';

export interface SubtitleSource {
  assetId: string;
  /** The delivered file on local disk. */
  inputPath: string;
  workDir: string;
  streams: SubtitleStream[];
}

/**
 * Soft subtitles muxed into a delivery become public WebVTT files next to its HLS output
 * (`hls/<assetId>/subtitles/<lang>.vtt`). A stream that cannot be converted is logged and
 * left out: subtitles never fail the delivery itself.
 */
export async function storeSubtitles(
  processor: MediaProcessor,
  storage: ObjectStorage,
  logger: Logger,
  source: SubtitleSource,
): Promise<ReadySubtitle[]> {
  const plan = planSubtitles(source.streams);
  for (const reason of plan.skipped) logger.warn(`Media ${source.assetId}: skipped ${reason}`);
  if (!plan.tracks.length) return [];

  const dir = path.join(source.workDir, 'subtitles');
  await mkdir(dir, { recursive: true });
  const stored: ReadySubtitle[] = [];
  for (const track of plan.tracks) {
    const file = path.join(dir, `${track.language}.vtt`);
    const key = `hls/${source.assetId}/subtitles/${track.language}.vtt`;
    try {
      await processor.extractSubtitle(source.inputPath, track.position, file);
      if (!isWebVtt(await readFile(file, 'utf8'))) throw new Error('the output is not WebVTT or holds no cue');
      await storage.putFile(key, file, contentTypeOf(file), 'public');
      stored.push({ language: track.language, fileUrl: storage.publicUrl(key), isDefault: track.isDefault });
    } catch (error) {
      logger.warn(
        `Media ${source.assetId}: subtitle stream ${track.position} (${track.language}) left out: ${(error as Error).message}`,
      );
    }
  }
  return stored;
}
