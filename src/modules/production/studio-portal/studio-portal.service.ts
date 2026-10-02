import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ContentReviewDecision, MovieStatus, StudioResponse, type MediaAsset } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import type {
  AiDisclosureDto,
  SubmitMediaLinkRequestDto,
  SubmitMediaUploadRequestDto,
} from 'src/modules/production/media-ingest/dto/submit-media.request.dto';
import { MediaIngestService } from 'src/modules/production/media-ingest/media-ingest.service';
import { DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { hashPortalToken, PORTAL_TOKEN_PATTERN } from 'src/modules/production/studio-handoff/portal-token';
import { type RespondToHandoffRequestDto, STUDIO_DECISION } from './dto/studio-portal.request.dto';

/** The studio still sees a finished project (its history), but nothing once it is cancelled. */
const VISIBLE_PROJECT: MovieStatus[] = [...DELIVERY_PROJECT_STATUSES, MovieStatus.COMPLETED];

const LATEST_DELIVERY = {
  orderBy: { version: 'desc' },
  take: 1,
  select: {
    id: true,
    version: true,
    ingestStatus: true,
    failureReason: true,
    durationSeconds: true,
    createdAt: true,
    contentReviews: {
      where: { decision: ContentReviewDecision.CHANGES_REQUESTED },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { comments: true, createdAt: true },
    },
  },
} as const;

type PortalHandoff = Awaited<ReturnType<StudioPortalService['resolve']>>;

/**
 * What an outside studio does through the private link of its hand-off (MF-1 steps 3–6): read the
 * brief, take or decline the project, deliver episodes with its own AI Disclosure and read the
 * changes asked of it. The link is the only credential; it dies when the studio is changed.
 */
@Injectable()
export class StudioPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly media: MediaIngestService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async overview(token: string) {
    const handoff = await this.resolve(token);
    const movie = await this.prisma.movie.findUniqueOrThrow({
      where: { id: handoff.movieId },
      include: {
        creator: { select: { fullName: true, email: true } },
        genres: { include: { genre: { select: { name: true } } } },
        ideaFiles: { orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
        seasons: {
          orderBy: { seasonNumber: 'asc' },
          include: {
            episodes: {
              orderBy: { episodeNumber: 'asc' },
              select: {
                id: true,
                episodeNumber: true,
                title: true,
                synopsis: true,
                targetDurationSeconds: true,
                dueDate: true,
                status: true,
                mediaAssets: LATEST_DELIVERY,
              },
            },
          },
        },
      },
    });
    const accepted = handoff.studioResponse === StudioResponse.ACCEPTED;

    return {
      studio: {
        studioName: handoff.studioName,
        studioEmail: handoff.studioEmail,
        handedOffAt: handoff.createdAt,
        response: handoff.studioResponse,
        respondedAt: handoff.respondedAt,
        declineReason: handoff.declineReason,
      },
      project: {
        title: movie.title,
        status: movie.status,
        ideaDescription: movie.ideaDescription,
        genres: movie.genres.map(({ genre }) => genre.name),
        productionFeeTokens: Number(handoff.productionFeeTokens),
        creator: movie.creator,
      },
      canDeliver: accepted && DELIVERY_PROJECT_STATUSES.includes(movie.status),
      seasons: movie.seasons.map((season) => ({
        seasonNumber: season.seasonNumber,
        title: season.title,
        episodes: season.episodes.map(({ mediaAssets, ...episode }) => {
          const [latest] = mediaAssets;
          return {
            ...episode,
            latestDelivery: latest
              ? {
                  id: latest.id,
                  version: latest.version,
                  ingestStatus: latest.ingestStatus,
                  failureReason: latest.failureReason,
                  durationSeconds: latest.durationSeconds,
                  createdAt: latest.createdAt,
                }
              : null,
            // Only while the studio has something to fix.
            changesRequested: episode.status === 'CHANGES_REQUESTED' ? (latest?.contentReviews[0] ?? null) : null,
          };
        }),
      })),
      // The latest version of every idea file, as the brief email carries them.
      ideaFiles: movie.ideaFiles
        .filter((file, i, all) => all.findIndex((other) => other.fileName === file.fileName) === i)
        .map((file) => ({ id: file.id, fileName: file.fileName, version: file.version })),
    };
  }

  /** Accept or decline, once; the Creator and the Reviewer are told either way. */
  async respond(token: string, dto: RespondToHandoffRequestDto) {
    const handoff = await this.resolve(token);
    if (!DELIVERY_PROJECT_STATUSES.includes(handoff.movie.status)) {
      throw new ConflictException('The project is no longer waiting for the studio');
    }
    const accept = dto.decision === STUDIO_DECISION.ACCEPT;
    const reason = accept ? null : dto.reason?.trim();
    if (!accept && !reason) throw new BadRequestException('Say why the studio declines');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.studioHandoff.updateMany({
        where: { id: handoff.id, studioResponse: null, portalRevokedAt: null },
        data: {
          studioResponse: accept ? StudioResponse.ACCEPTED : StudioResponse.DECLINED,
          respondedAt: new Date(),
          declineReason: reason,
        },
      });
      if (count === 0) throw new ConflictException('The studio has already answered this hand-off');
      await this.auditLog.record(
        {
          action: accept ? CONTENT_EVENT.STUDIO_ACCEPTED : CONTENT_EVENT.STUDIO_DECLINED,
          entityType: 'StudioHandoff',
          entityId: handoff.id,
          movieId: handoff.movieId,
          actorId: null,
          actorType: 'STUDIO',
          payload: { studioName: handoff.studioName, reason },
        },
        tx,
      );
      await this.notifications.notify(
        [handoff.movie.creatorId, handoff.movie.reviewerId],
        accept
          ? {
              type: NOTIFICATION_TYPE.STUDIO_ACCEPTED,
              title: `${handoff.studioName} accepted "${handoff.movie.title}"`,
              body: 'The studio agreed to the brief and the due dates.',
              link: `/projects/${handoff.movieId}/studio`,
              payload: { movieId: handoff.movieId, handoffId: handoff.id },
            }
          : {
              type: NOTIFICATION_TYPE.STUDIO_DECLINED,
              title: `${handoff.studioName} declined "${handoff.movie.title}"`,
              body: `${reason} Hand the project to another studio.`,
              link: `/projects/${handoff.movieId}/studio`,
              payload: { movieId: handoff.movieId, handoffId: handoff.id },
            },
        tx,
      );
    });
    return this.overview(token);
  }

  async submitLink(token: string, episodeId: string, dto: SubmitMediaLinkRequestDto) {
    const studio = await this.deliverer(token, episodeId);
    return deliveryView(await this.media.submitLink(episodeId, dto, { studio }));
  }

  async submitUpload(
    token: string,
    episodeId: string,
    file: Express.Multer.File | undefined,
    dto: SubmitMediaUploadRequestDto,
    disclosure: AiDisclosureDto,
  ) {
    const studio = await this.deliverer(token, episodeId);
    return deliveryView(await this.media.submitUpload(episodeId, file, dto, disclosure, { studio }));
  }

  async brief(token: string): Promise<StreamableFile> {
    const handoff = await this.resolve(token);
    if (!handoff.briefFileKey) throw new NotFoundException('Brief not found');
    return new StreamableFile(await this.storage.stream(handoff.briefFileKey, 'private'), {
      type: 'application/pdf',
      disposition: `attachment; filename="brief-${handoff.movieId}.pdf"`,
    });
  }

  async ideaFile(token: string, fileId: string): Promise<StreamableFile> {
    const handoff = await this.resolve(token);
    const file = await this.prisma.movieIdeaFile.findFirst({ where: { id: fileId, movieId: handoff.movieId } });
    if (!file) throw new NotFoundException('Idea file not found');
    return new StreamableFile(await this.storage.stream(file.storageKey, 'private'), {
      type: file.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: Number(file.sizeBytes),
    });
  }

  /** The live hand-off behind a link; a revoked, unknown or malformed link all look the same. */
  async resolve(token: string) {
    const invalid = new NotFoundException('This studio link is no longer valid');
    if (!PORTAL_TOKEN_PATTERN.test(token)) throw invalid;
    const handoff = await this.prisma.studioHandoff.findUnique({
      where: { portalTokenHash: hashPortalToken(token) },
      include: { movie: { select: { title: true, status: true, creatorId: true, reviewerId: true } } },
    });
    if (!handoff || handoff.portalRevokedAt) throw invalid;
    if (!VISIBLE_PROJECT.includes(handoff.movie.status))
      throw new GoneException('The project is no longer in production');
    return handoff;
  }

  /** Only a studio that took the project delivers, and only episodes of that project. */
  private async deliverer(token: string, episodeId: string) {
    const handoff: PortalHandoff = await this.resolve(token);
    if (handoff.studioResponse !== StudioResponse.ACCEPTED) {
      throw new ConflictException('Accept the project before delivering episodes');
    }
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, movieId: handoff.movieId },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return { handoffId: handoff.id, studioName: handoff.studioName };
  }
}

/** What the studio gets back after delivering: no storage keys or processing internals. */
function deliveryView(asset: MediaAsset) {
  return {
    id: asset.id,
    episodeId: asset.episodeId,
    version: asset.version,
    ingestStatus: asset.ingestStatus,
    failureReason: asset.failureReason,
    createdAt: asset.createdAt,
  };
}
