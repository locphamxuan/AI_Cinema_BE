import { ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { StudioMilestoneStatus, type Studio } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EMAIL_TEMPLATE } from 'src/modules/platform/email/email-outbox.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProjectAccessService, type TitledProject } from 'src/modules/production/project-access/project-access.service';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { ProjectLifecycleService } from 'src/modules/production/movie-project/project-lifecycle.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { StudioMailService } from 'src/modules/production/studio/studio-mail.service';
import { StudioService } from 'src/modules/production/studio/studio.service';
import { formatVnd } from './brief/brief-pdf';
import { BriefService, type PreparedBrief } from './brief/brief.service';
import type { ChangeStudioRequestDto } from './dto/studio-handoff.request.dto';
import { assertFeeFits, splitForfeit } from './handoff-fee';

const HISTORY_INCLUDE = {
  studio: { select: { id: true, name: true, email: true } },
  season: { select: { id: true, seasonNumber: true, title: true } },
  createdBy: { select: { id: true, fullName: true } },
  emailMessage: { select: { status: true, sentAt: true, errorMessage: true } },
  materials: { orderBy: { createdAt: 'asc' } },
  // A studio change waits for its contract: the rounds tell whether the new studio signed yet.
  contracts: { orderBy: { round: 'asc' }, select: { id: true, round: true, status: true, costVnd: true } },
  milestoneEvents: {
    orderBy: { createdAt: 'asc' },
    include: {
      changedBy: { select: { id: true, fullName: true } },
      mediaAsset: { select: { id: true, version: true, episodeId: true, ingestStatus: true } },
    },
  },
} as const;

/** The new hand-off a studio change records: the studio, its scope and the brief emailed to it. */
interface NewHandoff {
  studio: Studio;
  seasonId: string | null;
  brief: PreparedBrief;
  reason: string;
  /** VND the replaced studios kept (BR-59). */
  forfeitedVnd: number;
}

/**
 * MF-1 hand-off history and studio change (BR-13, BR-59). The first hand-off opens when the contract carries both
 * signatures (ContractHandoffService); its milestones then move by themselves (deliver-on-submission). Only the
 * Admin changes the studio: the brief PDF is emailed under the Admin's name, scripts never leave the platform.
 */
@Injectable()
export class StudioHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly studios: StudioService,
    private readonly costs: ProductionCostService,
    private readonly briefs: BriefService,
    private readonly mails: StudioMailService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
    private readonly contracts: ContractService,
    private readonly lifecycle: ProjectLifecycleService,
  ) {}

  async changeStudio(projectId: string, dto: ChangeStudioRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'read');
    assertProjectStatus(project.status, DELIVERY_PROJECT_STATUSES, 'change the studio');
    const studio = await this.studios.resolve(dto, null, user);
    const seasonId = await this.scopeSeason(projectId, dto.seasonId);
    const replaced = await this.prisma.studioHandoff.findMany({
      where: { projectId, seasonId, milestoneStatus: { not: StudioMilestoneStatus.SUPERSEDED } },
    });
    if (!replaced.length) throw new ConflictException('There is no hand-off for that scope to replace');

    const forfeitedVnd = dto.forfeitedVnd ?? 0;
    const forfeited = splitForfeit(replaced, forfeitedVnd);
    const releasedVnd = replaced.reduce((sum, h) => sum + Number(h.offeredFeeVnd), 0) - forfeitedVnd;
    assertFeeFits(await this.costs.summary(projectId), dto.offeredFeeVnd, releasedVnd);
    const brief = await this.briefs.prepare(projectId, studio, seasonId, {
      senderId: user.id,
      offeredFeeVnd: dto.offeredFeeVnd,
    });
    const handoff: NewHandoff = { studio, seasonId, brief, reason: dto.reason.trim(), forfeitedVnd };

    const mailId = await this.prisma.$transaction(async (tx) => {
      for (const { id, forfeitedVnd: kept } of forfeited) {
        await tx.studioHandoff.update({
          where: { id },
          data: { milestoneStatus: StudioMilestoneStatus.SUPERSEDED, forfeitedVnd: BigInt(kept) },
        });
      }
      await tx.studioMilestoneEvent.createMany({
        data: replaced.map((old) => ({
          handoffId: old.id,
          fromStatus: old.milestoneStatus,
          toStatus: StudioMilestoneStatus.SUPERSEDED,
          note: handoff.reason,
          changedById: user.id,
        })),
      });
      await tx.movieProject.update({ where: { id: projectId }, data: { studioId: studio.id } });
      // After the old studios are superseded, so what they give back is already in the budget.
      await this.costs.assertAffordable(tx, projectId, dto.offeredFeeVnd);
      if (studio.id !== project.studioId) await this.lifecycle.announceStudio(projectId, studio, tx);
      return this.record(tx, project, handoff, user);
    });
    await this.mails.dispatch(mailId);
    return this.history(projectId, user);
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

  /** Records the new hand-off with its brief email; returns the email to dispatch once committed. */
  private async record(tx: PrismaTx, project: TitledProject, handoff: NewHandoff, user: AuthenticatedUser) {
    const { studio, seasonId, brief, reason, forfeitedVnd } = handoff;
    const created = await tx.studioHandoff.create({
      data: {
        projectId: project.id,
        studioId: studio.id,
        seasonId,
        offeredFeeVnd: BigInt(brief.offeredFeeVnd),
        changeReason: reason,
        briefFileKey: brief.briefKey,
        createdById: user.id,
        milestoneEvents: {
          create: { fromStatus: null, toStatus: StudioMilestoneStatus.BRIEF_SENT, changedById: user.id },
        },
      },
    });
    // The new studio starts once it signs: the hand-off waits in BRIEF_SENT for this contract.
    await this.contracts.sendForStudioChange(tx, {
      projectId: project.id,
      studioId: studio.id,
      handoffId: created.id,
      actorId: user.id,
    });
    const mailId = await this.mails.queue(tx, {
      studioId: studio.id,
      senderId: user.id,
      subject: brief.subject,
      lines: [...brief.lines, 'Vui lòng đăng nhập Studio Web để xem hợp đồng, xác nhận chi phí sản xuất và ký.'],
      portalPath: '/contracts',
      failureLink: `/projects/${project.id}/studio`,
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      attachments: brief.attachments,
    });
    await tx.studioHandoff.update({ where: { id: created.id }, data: { emailMessageId: mailId } });
    await this.auditLog.record(
      {
        action: CONTENT_EVENT.STUDIO_CHANGED,
        entityType: 'StudioHandoff',
        entityId: created.id,
        projectId: project.id,
        actorId: user.id,
        payload: { studio: studio.name, seasonId, reason, offeredFeeVnd: brief.offeredFeeVnd, forfeitedVnd },
      },
      tx,
    );
    await this.notifications.notify(
      [project.reviewerId],
      {
        type: NOTIFICATION_TYPE.STUDIO_HANDOFF_SENT,
        title: `Admin đổi Studio của phim "${project.movie.title}" sang ${studio.name}`,
        body: `Lý do: ${reason}. Chi phí mất do đổi Studio: ${formatVnd(forfeitedVnd)}. Brief mới đề xuất ${formatVnd(brief.offeredFeeVnd)}.`,
        link: `/projects/${project.id}/studio`,
        payload: { projectId: project.id, handoffId: created.id, studioId: studio.id, seasonId },
      },
      tx,
    );
    return mailId;
  }
}
