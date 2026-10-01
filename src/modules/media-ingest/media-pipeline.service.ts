import { createWriteStream } from 'node:fs';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { IngestJobType, JobStatus, MediaIngestStatus, MediaSourceMethod, type MediaAsset } from '@prisma/client';
import { FILE_KINDS } from 'src/common/validation/uploaded-file';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { contentTypeOf, ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { probeHls } from './hls-playlist';
import { DONE, MediaOutcomeService, type ReadyResult } from './media-outcome.service';
import { MediaProcessor } from './media-processor';
import { downloadTo, UnsafeUrlError, type UrlPolicy } from './safe-url';

export const MEDIA_INGEST_JOB = 'media.ingest';

/** Video files a studio may deliver. */
export const VIDEO_KINDS = [FILE_KINDS.mp4, FILE_KINDS.mov];

export interface MediaIngestJobData {
  mediaAssetId: string;
}

/** A delivery that can never succeed as it is (bad link, not a video): failed at once, not retried. */
export class MediaRejectedError extends Error {}

/**
 * MF-1 step 6 (§4.1.3): HLS_URL → VALIDATING; UPLOAD → TRANSCODING; REMOTE_FILE →
 * DOWNLOADING → TRANSCODING, each step a media_ingest_jobs row with its attempts.
 * MediaOutcomeService records how it ends.
 */
@Injectable()
export class MediaPipelineService implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    private readonly storage: ObjectStorage,
    private readonly processor: MediaProcessor,
    private readonly outcomes: MediaOutcomeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.queue.register<MediaIngestJobData>(MEDIA_INGEST_JOB, ({ mediaAssetId }) => this.process(mediaAssetId), {
      attempts: 3,
      backoffMs: 15_000,
      concurrency: this.config.media.concurrency,
      onFailed: ({ mediaAssetId }, error) => this.outcomes.fail(mediaAssetId, error.message),
    });
  }

  /**
   * Without Redis a job lives in the request that started it, so a restart cuts it off and leaves
   * the episode PROCESSING. Such deliveries are failed at start-up so the Creator can retry them.
   * With Redis, BullMQ picks stalled jobs up again by itself.
   */
  async onApplicationBootstrap() {
    if (this.queue.runsInBackground) return;
    const interrupted = await this.prisma.mediaAsset.findMany({
      where: { ingestStatus: { notIn: DONE } },
      select: { id: true },
    });
    for (const { id } of interrupted) await this.outcomes.fail(id, 'Processing was interrupted by a server restart.');
  }

  get urlPolicy(): UrlPolicy {
    return { allowPrivate: this.config.media.allowPrivateUrls };
  }

  /** One attempt; transient errors are thrown so the queue retries, rejections fail at once. */
  async process(mediaAssetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (!asset || DONE.includes(asset.ingestStatus)) return;

    const workDir = await mkdtemp(path.join(tmpdir(), 'aicinema-ingest-'));
    try {
      const result =
        asset.sourceMethod === MediaSourceMethod.HLS_URL
          ? await this.step(asset, IngestJobType.VALIDATE, MediaIngestStatus.VALIDATING, () => this.validateHls(asset))
          : await this.selfHost(asset, workDir);
      await this.outcomes.ready(asset, result);
    } catch (error) {
      if (!(error instanceof MediaRejectedError || error instanceof UnsafeUrlError)) throw error;
      await this.outcomes.fail(asset.id, error.message);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async validateHls(asset: MediaAsset): Promise<ReadyResult> {
    const probed = await probeHls(asset.sourceUrl!, this.urlPolicy);
    return { streamUrl: asset.sourceUrl!, ...probed, lastCheckedAt: new Date() };
  }

  /** UPLOAD and REMOTE_FILE: the original lands in private storage, renditions in public storage. */
  private async selfHost(asset: MediaAsset, workDir: string): Promise<ReadyResult> {
    const source = path.join(workDir, 'source');
    // An import is downloaded once; a retry after a failed transcode starts from the stored copy.
    const storedKey = asset.storageKey;
    if (!storedKey) {
      await this.step(asset, IngestJobType.DOWNLOAD, MediaIngestStatus.DOWNLOADING, () => this.download(asset, source));
    }

    return this.step(asset, IngestJobType.TRANSCODE, MediaIngestStatus.TRANSCODING, async () => {
      if (storedKey) await pipeline(await this.storage.stream(storedKey, 'private'), createWriteStream(source));
      const probed = await this.processor.probe(source).catch((error: Error) => {
        throw new MediaRejectedError(error.message);
      });
      const hls = await this.processor.transcode(source, path.join(workDir, 'hls'), probed);
      const prefix = `hls/${asset.id}`;
      for (const file of await filesUnder(hls.outputDir)) {
        const relative = path.relative(hls.outputDir, file).split(path.sep).join('/');
        await this.storage.putFile(`${prefix}/${relative}`, file, contentTypeOf(file), 'public');
      }
      return {
        streamUrl: this.storage.publicUrl(`${prefix}/master.m3u8`),
        qualities: hls.qualities,
        durationSeconds: probed.durationSeconds,
      };
    });
  }

  /** Downloads an import URL to `target` and keeps the original in private storage. */
  private async download(asset: MediaAsset, target: string): Promise<void> {
    const size = await downloadTo(asset.sourceUrl!, target, this.urlPolicy, this.config.media.maxDownloadBytes);
    const head = Buffer.alloc(16);
    const handle = await open(target, 'r');
    await handle.read(head, 0, head.length, 0).finally(() => handle.close());
    // URLs often carry no extension, so the content alone decides.
    const kind = VIDEO_KINDS.find((candidate) => candidate.matches(head));
    if (!kind) throw new MediaRejectedError('The link does not lead to an MP4 or MOV video');
    const storageKey = `media/${asset.id}/source${kind.extensions[0]}`;
    await this.storage.putFile(storageKey, target, kind.mimeType, 'private');
    await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey, fileSizeBytes: BigInt(size) },
    });
  }

  /** Runs one pipeline step, recording it in media_ingest_jobs and on the asset. */
  private async step<T>(
    asset: MediaAsset,
    jobType: IngestJobType,
    status: MediaIngestStatus,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { ingestStatus: status } });
    const existing = await this.prisma.mediaIngestJob.findFirst({
      where: { mediaAssetId: asset.id, jobType },
      orderBy: { createdAt: 'desc' },
    });
    const running = { status: JobStatus.RUNNING, startedAt: new Date(), finishedAt: null, errorMessage: null };
    const job = existing
      ? await this.prisma.mediaIngestJob.update({
          where: { id: existing.id },
          data: { ...running, attempts: { increment: 1 } },
        })
      : await this.prisma.mediaIngestJob.create({
          data: { mediaAssetId: asset.id, jobType, ...running, attempts: 1 },
        });
    try {
      const result = await work();
      await this.prisma.mediaIngestJob.update({
        where: { id: job.id },
        data: { status: JobStatus.COMPLETED, progressPercent: 100, finishedAt: new Date() },
      });
      return result;
    } catch (error) {
      await this.prisma.mediaIngestJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}
