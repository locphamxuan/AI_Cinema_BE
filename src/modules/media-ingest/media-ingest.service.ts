import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { EpisodeStatus, MediaIngestStatus, MediaSourceMethod, type MediaAsset, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind } from 'src/common/validation/uploaded-file';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import {
  assertEpisodeStatus,
  assertProjectStatus,
  DELIVERY_PROJECT_STATUSES,
} from 'src/modules/project-access/project-rules';
import type {
  AiDisclosureDto,
  SubmitMediaLinkRequestDto,
  SubmitMediaUploadRequestDto,
} from './dto/submit-media.request.dto';
import { MediaOutcomeService } from './media-outcome.service';
import { MEDIA_INGEST_JOB, type MediaIngestJobData, VIDEO_KINDS } from './media-pipeline.service';
import { assertPublicUrl, UnsafeUrlError } from './safe-url';

/** A delivery is accepted while the studio still owes the episode, or replaces one under review. */
const SUBMITTABLE: EpisodeStatus[] = [
  EpisodeStatus.AWAITING_MEDIA,
  EpisodeStatus.IN_REVIEW,
  EpisodeStatus.CHANGES_REQUESTED,
];

const ASSET_DETAIL = {
  ingestJobs: { orderBy: { createdAt: 'asc' } },
  submittedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.MediaAssetInclude;

interface NewVersion {
  id: string;
  sourceMethod: MediaSourceMethod;
  sourceUrl?: string;
  storageKey?: string;
  fileSizeBytes?: bigint;
  isSelfHosted: boolean;
  aiDisclosure: AiDisclosureDto;
  proposedLabelType: SubmitMediaLinkRequestDto['proposedLabelType'];
  submissionNote?: string;
}

/** MF-1 step 5: the Creator delivers an episode; every delivery is a new immutable version (BR-14). */
@Injectable()
export class MediaIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly queue: JobQueue,
    private readonly auditLog: AuditLogService,
    private readonly outcomes: MediaOutcomeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async submitLink(episodeId: string, dto: SubmitMediaLinkRequestDto, user: AuthenticatedUser) {
    await this.assertCanSubmit(episodeId, user);
    // Refused up front for a quick answer; the worker checks every hop again (redirects, DNS changes).
    await assertPublicUrl(dto.sourceUrl, { allowPrivate: this.config.media.allowPrivateUrls }).catch((error) => {
      throw error instanceof UnsafeUrlError ? new BadRequestException(error.message) : error;
    });
    const asset = await this.createVersion(episodeId, user, {
      id: randomUUID(),
      sourceMethod: dto.sourceMethod,
      sourceUrl: dto.sourceUrl,
      isSelfHosted: dto.sourceMethod === MediaSourceMethod.REMOTE_FILE,
      aiDisclosure: dto.aiDisclosure,
      proposedLabelType: dto.proposedLabelType,
      submissionNote: dto.submissionNote?.trim() || undefined,
    });
    return this.enqueue(asset.id);
  }

  /** `file` is the temporary copy multer wrote to disk; RemoveTempUploadInterceptor deletes it. */
  async submitUpload(
    episodeId: string,
    file: Express.Multer.File | undefined,
    dto: SubmitMediaUploadRequestDto,
    disclosure: AiDisclosureDto,
    user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('Attach the episode video as "file"');
    await this.assertCanSubmit(episodeId, user);
    const kind = detectKind(file.originalname, await this.headOf(file.path), VIDEO_KINDS);
    const id = randomUUID();
    const storageKey = `media/${id}/source${kind.extensions[0]}`;
    // Stored before the version row exists (its CHECK needs the key); copying gigabytes inside
    // a transaction would hold the episode lock far too long.
    await this.storage.putFile(storageKey, file.path, kind.mimeType, 'private');

    const asset = await this.createVersion(episodeId, user, {
      id,
      sourceMethod: MediaSourceMethod.UPLOAD,
      storageKey,
      fileSizeBytes: BigInt(file.size),
      isSelfHosted: true,
      aiDisclosure: disclosure,
      proposedLabelType: dto.proposedLabelType,
      submissionNote: dto.submissionNote?.trim() || undefined,
    }).catch(async (error: unknown) => {
      // No version points at the stored file (e.g. a concurrent delivery won): do not leave it behind.
      await this.storage.remove(storageKey, 'private').catch(() => undefined);
      throw error;
    });
    return this.enqueue(asset.id);
  }

  /** Every version of an episode, newest first. */
  async list(episodeId: string, user: AuthenticatedUser) {
    await this.access.episode(episodeId, user, 'read');
    return this.prisma.mediaAsset.findMany({
      where: { episodeId },
      orderBy: { version: 'desc' },
      include: ASSET_DETAIL,
    });
  }

  async get(mediaAssetId: string, user: AuthenticatedUser) {
    await this.access.mediaAsset(mediaAssetId, user, 'read');
    return this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId }, include: ASSET_DETAIL });
  }

  /** Runs a failed delivery again, e.g. once the studio fixed its link; only the latest version. */
  async retry(mediaAssetId: string, user: AuthenticatedUser) {
    const asset = await this.access.mediaAsset(mediaAssetId, user, 'creator');
    if (asset.ingestStatus !== MediaIngestStatus.FAILED) {
      throw new ConflictException('Only a failed delivery can be processed again');
    }
    assertProjectStatus(asset.episode.movie.status, DELIVERY_PROJECT_STATUSES, 'process media');
    assertEpisodeStatus(asset.episode.status, SUBMITTABLE, 'process media');

    await this.prisma.$transaction(async (tx) => {
      const latest = await tx.mediaAsset.findFirst({
        where: { episodeId: asset.episodeId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (latest?.id !== asset.id) throw new ConflictException('A newer version was delivered; retry that one');
      await this.lockEpisode(tx, asset.episodeId);
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { ingestStatus: MediaIngestStatus.PENDING, failureReason: null },
      });
    });
    return this.enqueue(asset.id, `${asset.id}-retry-${Date.now()}`);
  }

  private async assertCanSubmit(episodeId: string, user: AuthenticatedUser) {
    const episode = await this.access.episode(episodeId, user, 'creator');
    assertProjectStatus(episode.movie.status, DELIVERY_PROJECT_STATUSES, 'deliver media');
    if (episode.status === EpisodeStatus.PROCESSING) {
      throw new ConflictException('The previous delivery of this episode is still being processed');
    }
    assertEpisodeStatus(episode.status, SUBMITTABLE, 'deliver media');
  }

  private async createVersion(episodeId: string, user: AuthenticatedUser, data: NewVersion): Promise<MediaAsset> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockEpisode(tx, episodeId);
      const last = await tx.mediaAsset.aggregate({ where: { episodeId }, _max: { version: true } });
      const asset = await tx.mediaAsset.create({
        data: {
          ...data,
          aiDisclosure: { ...data.aiDisclosure },
          episodeId,
          version: (last._max.version ?? 0) + 1,
          submittedById: user.id,
        },
        include: { episode: { select: { movieId: true } } },
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.MEDIA_SUBMITTED,
          entityType: 'MediaAsset',
          entityId: asset.id,
          movieId: asset.episode.movieId,
          actorId: user.id,
          payload: { episodeId, version: asset.version, sourceMethod: asset.sourceMethod },
        },
        tx,
      );
      return asset;
    });
  }

  /** Moves the episode to PROCESSING; a concurrent delivery finds it locked and is refused. */
  private async lockEpisode(tx: PrismaTx, episodeId: string) {
    const { count } = await tx.episode.updateMany({
      where: { id: episodeId, status: { in: SUBMITTABLE } },
      data: { status: EpisodeStatus.PROCESSING },
    });
    if (count === 0) throw new ConflictException('The episode changed meanwhile; reload it');
  }

  private async enqueue(mediaAssetId: string, jobId: string = mediaAssetId) {
    try {
      await this.queue.add<MediaIngestJobData>(MEDIA_INGEST_JOB, { mediaAssetId }, jobId);
    } catch (error) {
      // Queue unreachable (Redis down): release the episode so the delivery can be retried.
      await this.outcomes.fail(mediaAssetId, 'The delivery could not be queued for processing; retry it.');
      throw error;
    }
    // Without Redis the job already ran; with it the caller sees PENDING and polls.
    return this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaAssetId }, include: ASSET_DETAIL });
  }

  private async headOf(filePath: string): Promise<Buffer> {
    const handle = await open(filePath, 'r');
    try {
      const head = Buffer.alloc(16);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      return head.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
