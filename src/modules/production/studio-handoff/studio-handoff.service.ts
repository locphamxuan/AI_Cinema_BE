import { ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { StudioMilestoneStatus, type Studio } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EMAIL_TEMPLATE, EmailOutboxService } from 'src/modules/platform/email/email-outbox.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService, type TitledProject } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { formatVnd } from './brief/brief-pdf';
import { assertFeeFits, splitForfeit } from './handoff-fee';
import { type BriefContext, BriefService, type PreparedBrief } from './brief/brief.service';
import type { ChangeStudioRequestDto } from './dto/studio-handoff.request.dto';
import { HandoffMaterialService, type MaterialUploads, type StoredMaterial } from './material/handoff-material.service';

const HISTORY_INCLUDE = {
  studio: { select: { id: true, name: true, email: true } },
  season: { select: { id: true, seasonNumber: true, title: true } },
  createdBy: { select: { id: true, fullName: true } },
  emailMessage: { select: { status: true, sentAt: true, errorMessage: true } },
  materials: { orderBy: { createdAt: 'asc' } },
  filmLinks: {
    orderBy: { episode: { episodeNumber: 'asc' } },
    include: { episode: { select: { episodeNumber: true } } },
  },
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
  /** VND the replaced studios kept (BR-59); 0 on a first hand-off. */
  forfeitedVnd: number;
}

/**
 * MF-1 hand-off history and studio change (BR-13, BR-59). Since 07/11/2026 the first hand-off is no longer sent by
 * the Creator: it opens when the contract carries both signatures (ContractHandoffService).
 */
@Injectable()
export class StudioHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly studios: StudioService,
    private readonly costs: ProductionCostService,
    private readonly briefs: BriefService,
    private readonly materials: HandoffMaterialService,
    private readonly emails: EmailOutboxService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  async changeStudio(
    projectId: string,
    dto: ChangeStudioRequestDto,
    uploads: MaterialUploads,
    user: AuthenticatedUser,
  ) {
    const project = await this.access.project(projectId, user, 'read');
    assertProjectStatus(project.status, DELIVERY_PROJECT_STATUSES, 'change the studio');
    const studio = await this.studios.resolve(dto, null, user);
    const seasonId = await this.scopeSeason(projectId, dto.seasonId);
    const replaced = await this.prisma.studioHandoff.findMany({
      where: { projectId, seasonId, milestoneStatus: { not: StudioMilestoneStatus.SUPERSEDED } },
    });
    if (!replaced.length) throw new ConflictException('There is no hand-off for that scope to replace');

    const forfeited = splitForfeit(replaced, dto.forfeitedVnd ?? 0);
    const releasedVnd = replaced.reduce((sum, h) => sum + Number(h.offeredFeeVnd), 0) - (dto.forfeitedVnd ?? 0);
    assertFeeFits(await this.costs.summary(projectId), dto.offeredFeeVnd, releasedVnd);
    const plan = await this.plan(projectId, studio, seasonId, uploads, dto.reason.trim(), {
      senderId: user.id,
      offeredFeeVnd: dto.offeredFeeVnd,
    });
    plan.forfeitedVnd = dto.forfeitedVnd ?? 0;
    return this.send(project, plan, user, async (tx) => {
      for (const { id, forfeitedVnd } of forfeited) {
        await tx.studioHandoff.update({
          where: { id },
          data: { milestoneStatus: StudioMilestoneStatus.SUPERSEDED, forfeitedVnd: BigInt(forfeitedVnd) },
        });
      }
      await tx.studioMilestoneEvent.createMany({
        data: replaced.map((handoff) => ({
          handoffId: handoff.id,
          fromStatus: handoff.milestoneStatus,
          toStatus: StudioMilestoneStatus.SUPERSEDED,
          note: plan.changeReason,
          changedById: user.id,
        })),
      });
      await tx.movieProject.update({ where: { id: projectId }, data: { studioId: studio.id } });
    });
  }

  /** Hand-offs, newest first, with materials and the full milestone timeline (BR-58, BR-59). */
  async history(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.prisma.studioHandoff.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: HISTORY_INCLUDE,
    });
  }

  async briefFile(projectId: string, handoffId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    await this.access.project(projectId, user, 'read');
    const handoff = await this.prisma.studioHandoff.findFirst({ where: { id: handoffId, projectId } });
    if (!handoff?.briefFileKey) throw new NotFoundException('Brief not found');
    return new StreamableFile(await this.storage.stream(handoff.briefFileKey, 'private'), {
      type: 'application/pdf',
      disposition: `attachment; filename="brief-${projectId}.pdf"`,
    });
  }

  /** The season a hand-off covers; null = the whole project. */
  private async scopeSeason(projectId: string, seasonId?: string): Promise<string | null> {
    if (!seasonId) return null;
    const season = await this.prisma.season.findFirst({
      where: { id: seasonId, movieId: projectId },
      select: { id: true },
    });
    if (!season) throw new NotFoundException('Season not found in this project');
    return season.id;
  }

  private async plan(
    projectId: string,
    studio: Studio,
    seasonId: string | null,
    uploads: MaterialUploads,
    changeReason: string | null,
    context: BriefContext,
  ): Promise<HandoffPlan> {
    const materials = await this.materials.store(projectId, uploads);
    try {
      const brief = await this.briefs.prepare(projectId, studio, seasonId, materials, context);
      return { studio, seasonId, materials, brief, changeReason, forfeitedVnd: 0 };
    } catch (error) {
      await this.materials.discard(materials);
      throw error;
    }
  }

  /** Runs `change` and records the hand-off with its email in one transaction, then queues the email. */
  private async send(
    project: TitledProject,
    plan: HandoffPlan,
    user: AuthenticatedUser,
    change: (tx: PrismaTx) => Promise<void>,
  ) {
    let emailId: string;
    try {
      emailId = await this.prisma.$transaction(async (tx) => {
        await change(tx);
        // After `change`, so a replaced studio's fee is already back in the budget.
        await this.costs.assertAffordable(tx, project.id, plan.brief.offeredFeeVnd);
        return this.recordHandoff(tx, project, plan, user);
      });
    } catch (error) {
      await this.materials.discard(plan.materials);
      throw error;
    }
    await this.emails.dispatch(emailId);
    return this.history(project.id, user);
  }

  private async recordHandoff(tx: PrismaTx, project: TitledProject, plan: HandoffPlan, user: AuthenticatedUser) {
    const { studio, seasonId, brief, materials, changeReason, forfeitedVnd } = plan;
    const emailId = await this.emails.create(tx, {
      to: studio.email,
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      subject: brief.subject,
      text: brief.text,
      attachments: brief.attachments,
      notifyOnFailureId: user.id,
      link: `/projects/${project.id}/studio`,
      fromName: brief.creatorName ? `${brief.creatorName} - AI Cinema` : undefined,
      replyTo: brief.creatorEmail || undefined,
    });
    const handoff = await tx.studioHandoff.create({
      data: {
        projectId: project.id,
        studioId: studio.id,
        seasonId,
        offeredFeeVnd: BigInt(brief.offeredFeeVnd),
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
        projectId: project.id,
        actorId: user.id,
        payload: {
          studio: studio.name,
          seasonId,
          materials: materials.length,
          reason: changeReason,
          offeredFeeVnd: brief.offeredFeeVnd,
          forfeitedVnd,
        },
      },
      tx,
    );
    // The Reviewer follows the project without asking the Creator what was sent where.
    if (project.reviewerId !== user.id) {
      await this.notifications.notify(
        [project.reviewerId],
        {
          type: NOTIFICATION_TYPE.STUDIO_HANDOFF_SENT,
          title: changeReason
            ? `Admin đổi Studio của phim "${project.movie.title}" sang ${studio.name}`
            : `Admin đã gửi bàn giao phim "${project.movie.title}" cho Studio ${studio.name}`,
          body: changeReason
            ? `Lý do: ${changeReason}. Chi phí mất do đổi Studio: ${formatVnd(forfeitedVnd)}. Brief mới đề xuất ${formatVnd(brief.offeredFeeVnd)}.`
            : `Phí sản xuất đề xuất: ${formatVnd(brief.offeredFeeVnd)}.`,
          link: `/projects/${project.id}/studio`,
          payload: { projectId: project.id, handoffId: handoff.id, studioId: studio.id, seasonId },
        },
        tx,
      );
    }
    return emailId;
  }
}
