import { ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { EpisodeStatus, MovieStatus, StudioMilestoneStatus, type Movie, type Studio } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { businessDay } from 'src/common/time/business-day';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EMAIL_TEMPLATE, EmailOutboxService } from 'src/modules/platform/email/email-outbox.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { BriefService, type PreparedBrief } from './brief/brief.service';
import type { ChangeStudioRequestDto, HandOffRequestDto } from './dto/studio-handoff.request.dto';
import { HandoffMaterialService, type MaterialUploads, type StoredMaterial } from './material/handoff-material.service';

const HISTORY_INCLUDE = {
  studio: { select: { id: true, name: true, email: true } },
  season: { select: { id: true, seasonNumber: true, title: true } },
  createdBy: { select: { id: true, fullName: true } },
  emailMessage: { select: { status: true, sentAt: true, errorMessage: true } },
  materials: { orderBy: { createdAt: 'asc' } },
  milestoneEvents: {
    orderBy: { createdAt: 'asc' },
    include: {
      changedBy: { select: { id: true, fullName: true } },
      mediaAsset: { select: { id: true, version: true, episodeId: true, ingestStatus: true } },
    },
  },
} as const;

/** What one hand-off sends: a studio, a scope (whole project or one season) and the files that go with it. */
interface HandoffPlan {
  studio: Studio;
  seasonId: string | null;
  materials: StoredMaterial[];
  brief: PreparedBrief;
  changeReason: string | null;
}

/** MF-1 steps 3–4: hand the project (or a season) to a studio outside the platform, or change studio (BR-13, BR-59). */
@Injectable()
export class StudioHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly studios: StudioService,
    private readonly briefs: BriefService,
    private readonly materials: HandoffMaterialService,
    private readonly emails: EmailOutboxService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
  ) {}

  async handOff(movieId: string, dto: HandOffRequestDto, uploads: MaterialUploads, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, [MovieStatus.ASSIGNED, MovieStatus.IN_PRODUCTION], 'hand the project off');
    const studio = await this.studios.resolve(dto, movie.studioId, user);
    if (movie.studioId && movie.studioId !== studio.id) {
      throw new ConflictException('The project already has a studio; change the studio instead');
    }
    const seasonId = await this.scopeSeason(movieId, dto.seasonId);
    const episodes = await this.episodesToHandOff(movieId, seasonId);

    const plan = await this.plan(movieId, studio, seasonId, uploads, null);
    return this.send(movie, plan, user, async (tx) => {
      const { count } = await tx.movie.updateMany({
        where: { id: movieId, status: { in: [MovieStatus.ASSIGNED, MovieStatus.IN_PRODUCTION] } },
        data: {
          studioId: studio.id,
          status: MovieStatus.IN_PRODUCTION,
          ...(movie.handedOffAt ? {} : { handedOffAt: new Date() }),
        },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      // The studio is due on the Reviewer's deadline of each episode (BR-38).
      for (const { id, deliveryDeadline } of episodes) {
        await tx.episode.update({
          where: { id },
          data: { dueDate: deliveryDeadline, status: EpisodeStatus.AWAITING_MEDIA },
        });
      }
    });
  }

  async changeStudio(movieId: string, dto: ChangeStudioRequestDto, uploads: MaterialUploads, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, DELIVERY_PROJECT_STATUSES, 'change the studio');
    const studio = await this.studios.resolve(dto, null, user);
    const seasonId = await this.scopeSeason(movieId, dto.seasonId);
    const replaced = await this.prisma.studioHandoff.findMany({
      where: { movieId, seasonId, milestoneStatus: { not: StudioMilestoneStatus.SUPERSEDED } },
    });
    if (!replaced.length) throw new ConflictException('There is no hand-off for that scope to replace');

    const plan = await this.plan(movieId, studio, seasonId, uploads, dto.reason.trim());
    return this.send(movie, plan, user, async (tx) => {
      await tx.studioHandoff.updateMany({
        where: { id: { in: replaced.map(({ id }) => id) } },
        data: { milestoneStatus: StudioMilestoneStatus.SUPERSEDED },
      });
      await tx.studioMilestoneEvent.createMany({
        data: replaced.map((handoff) => ({
          handoffId: handoff.id,
          fromStatus: handoff.milestoneStatus,
          toStatus: StudioMilestoneStatus.SUPERSEDED,
          note: plan.changeReason,
          changedById: user.id,
        })),
      });
      await tx.movie.update({ where: { id: movieId }, data: { studioId: studio.id } });
    });
  }

  /** Hand-offs, newest first, with materials and the full milestone timeline (BR-58, BR-59). */
  async history(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    return this.prisma.studioHandoff.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
      include: HISTORY_INCLUDE,
    });
  }

  async briefFile(movieId: string, handoffId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    await this.access.movie(movieId, user, 'read');
    const handoff = await this.prisma.studioHandoff.findFirst({ where: { id: handoffId, movieId } });
    if (!handoff?.briefFileKey) throw new NotFoundException('Brief not found');
    return new StreamableFile(await this.storage.stream(handoff.briefFileKey, 'private'), {
      type: 'application/pdf',
      disposition: `attachment; filename="brief-${movieId}.pdf"`,
    });
  }

  /** The season a hand-off covers; null = the whole project. */
  private async scopeSeason(movieId: string, seasonId?: string): Promise<string | null> {
    if (!seasonId) return null;
    const season = await this.prisma.season.findFirst({ where: { id: seasonId, movieId }, select: { id: true } });
    if (!season) throw new NotFoundException('Season not found in this project');
    return season.id;
  }

  /** Episodes of the scope the studio does not owe yet; their deadline must not be past (BR-38). */
  private async episodesToHandOff(
    movieId: string,
    seasonId: string | null,
  ): Promise<{ id: string; deliveryDeadline: Date }[]> {
    const episodes = await this.prisma.episode.findMany({
      where: { movieId, dueDate: null, ...(seasonId ? { seasonId } : {}) },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, episodeNumber: true, deliveryDeadline: true },
    });
    if (!episodes.length) throw new ConflictException('Every episode of this scope was already handed off');
    const today = businessDay();
    const late = episodes.filter((e) => !e.deliveryDeadline || e.deliveryDeadline < today).map((e) => e.episodeNumber);
    if (late.length) {
      throw new ConflictException(
        `Episodes ${late.join(', ')} have no delivery deadline or one already past; the Reviewer must set it first`,
      );
    }
    return episodes.map(({ id, deliveryDeadline }) => ({ id, deliveryDeadline: deliveryDeadline! }));
  }

  private async plan(
    movieId: string,
    studio: Studio,
    seasonId: string | null,
    uploads: MaterialUploads,
    changeReason: string | null,
  ): Promise<HandoffPlan> {
    const materials = await this.materials.store(movieId, uploads);
    try {
      const brief = await this.briefs.prepare(movieId, studio, seasonId, materials);
      return { studio, seasonId, materials, brief, changeReason };
    } catch (error) {
      await this.materials.discard(materials);
      throw error;
    }
  }

  /** Runs `change` and records the hand-off with its email in one transaction, then queues the email. */
  private async send(
    movie: Movie,
    plan: HandoffPlan,
    user: AuthenticatedUser,
    change: (tx: PrismaTx) => Promise<void>,
  ) {
    let emailId: string;
    try {
      emailId = await this.prisma.$transaction(async (tx) => {
        await change(tx);
        return this.recordHandoff(tx, movie, plan, user);
      });
    } catch (error) {
      await this.materials.discard(plan.materials);
      throw error;
    }
    await this.emails.dispatch(emailId);
    return this.history(movie.id, user);
  }

  private async recordHandoff(tx: PrismaTx, movie: Movie, plan: HandoffPlan, user: AuthenticatedUser) {
    const { studio, seasonId, brief, materials, changeReason } = plan;
    const emailId = await this.emails.create(tx, {
      to: studio.email,
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      subject: brief.subject,
      text: brief.text,
      attachments: brief.attachments,
      notifyOnFailureId: user.id,
      link: `/projects/${movie.id}/studio`,
      fromName: brief.creatorName || undefined,
      replyTo: brief.creatorEmail || undefined,
    });
    const handoff = await tx.studioHandoff.create({
      data: {
        movieId: movie.id,
        studioId: studio.id,
        seasonId,
        productionFeeTokens: BigInt(brief.productionFeeTokens),
        changeReason,
        briefFileKey: brief.briefKey,
        emailMessageId: emailId,
        createdById: user.id,
        materials: {
          create: materials.map((material) => ({ ...material, uploadedById: user.id })),
        },
        milestoneEvents: {
          create: { fromStatus: null, toStatus: StudioMilestoneStatus.BRIEF_SENT, changedById: user.id },
        },
      },
    });
    await this.auditLog.record(
      {
        action: changeReason ? CONTENT_EVENT.STUDIO_CHANGED : CONTENT_EVENT.STUDIO_HANDOFF_SENT,
        entityType: 'StudioHandoff',
        entityId: handoff.id,
        movieId: movie.id,
        actorId: user.id,
        payload: { studio: studio.name, seasonId, materials: materials.length, reason: changeReason },
      },
      tx,
    );
    return emailId;
  }
}
