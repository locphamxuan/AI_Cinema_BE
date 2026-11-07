import { ConflictException, Injectable } from '@nestjs/common';
import { ProjectStatus, ScriptReviewStage, ScriptStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { ProjectAccessService, type TitledProject } from 'src/modules/production/project-access/project-access.service';
import { StudioService } from 'src/modules/production/studio/studio.service';
import type {
  FinalReviewScriptRequestDto,
  ReviewScriptRequestDto,
  SubmitScriptRequestDto,
} from './dto/script.request.dto';

const PERSON = { select: { id: true, fullName: true } } as const;
const SCRIPT_DETAIL = {
  versions: { orderBy: { version: 'desc' }, include: { submittedBy: PERSON } },
  reviews: { orderBy: { createdAt: 'desc' }, include: { reviewer: PERSON } },
} as const;

/** The Creator may (re)submit before the first review or once the script was sent back. */
const WRITABLE: (ScriptStatus | null)[] = [null, ScriptStatus.REVISION_REQUESTED];

/**
 * MF-1 §2 (07/11/2026): the lead Creator writes the script; the Reviewer approves it or sends it back (loop);
 * the Admin then approves the Final Script or sends it straight back to the Creator, who resubmits it to the
 * Reviewer. Approving the Final Script locks it and has the system send the studio its template contract.
 */
@Injectable()
export class ScriptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly contracts: ContractService,
    private readonly studios: StudioService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async get(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.find(projectId);
  }

  /** The script with every version and review, newest first; null before the first submission. */
  find(projectId: string, tx?: PrismaTx) {
    return (tx ?? this.prisma).projectScript.findUnique({ where: { projectId }, include: SCRIPT_DETAIL });
  }

  async submit(projectId: string, dto: SubmitScriptRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'lead');
    this.assertAssigned(project);
    return this.prisma.$transaction(async (tx) => {
      const script = await tx.projectScript.findUnique({ where: { projectId } });
      if (!WRITABLE.includes(script?.status ?? null)) {
        throw new ConflictException(`The script is ${script!.status}; wait for its review`);
      }
      const version = (script?.currentVersion ?? 0) + 1;
      await tx.projectScript.upsert({
        where: { projectId },
        create: { projectId, currentVersion: version },
        update: { currentVersion: version, status: ScriptStatus.SUBMITTED },
      });
      await tx.scriptVersion.create({
        data: { projectId, version, content: dto.content, note: dto.note || null, submittedById: user.id },
      });
      await this.record(tx, project, CONTENT_EVENT.SCRIPT_SUBMITTED, user.id, { version });
      await this.tell(tx, [project.reviewerId], project, `Creator đã nộp kịch bản bản ${version}, chờ Reviewer duyệt.`);
      return this.find(projectId, tx);
    });
  }

  /** The Reviewer of the project passes the submitted version to the Admin, or sends it back. */
  async review(projectId: string, dto: ReviewScriptRequestDto, user: AuthenticatedUser) {
    const project = await this.access.project(projectId, user, 'reviewer');
    this.assertAssigned(project);
    return this.prisma.$transaction(async (tx) => {
      const script = await this.locked(tx, projectId, ScriptStatus.SUBMITTED);
      const status = dto.approve ? ScriptStatus.REVIEWER_APPROVED : ScriptStatus.REVISION_REQUESTED;
      await this.decide(tx, script.currentVersion, projectId, ScriptReviewStage.REVIEWER, dto, user.id, status);
      if (dto.approve) {
        await this.tell(
          tx,
          await this.notifications.adminIds(tx),
          project,
          `Reviewer đã duyệt kịch bản bản ${script.currentVersion}; mời Admin xem xét Kịch bản Final.`,
        );
      } else {
        await this.tell(tx, [project.creatorId], project, `Reviewer yêu cầu sửa kịch bản: ${dto.comment}`);
      }
      return this.find(projectId, tx);
    });
  }

  /** The Admin approves the Final Script (the studio then gets its contract) or sends it back to the Creator. */
  async finalReview(projectId: string, dto: FinalReviewScriptRequestDto, admin: AuthenticatedUser) {
    const project = await this.access.project(projectId, admin, 'read');
    this.assertAssigned(project);
    if (dto.approve) await this.assertReadyForStudio(project, dto.studioId);
    return this.prisma.$transaction(async (tx) => {
      const script = await this.locked(tx, projectId, ScriptStatus.REVIEWER_APPROVED);
      const version = script.currentVersion;
      if (!dto.approve) {
        await this.decide(
          tx,
          version,
          projectId,
          ScriptReviewStage.ADMIN,
          dto,
          admin.id,
          ScriptStatus.REVISION_REQUESTED,
        );
        await this.tell(
          tx,
          [project.creatorId, project.reviewerId],
          project,
          `Admin yêu cầu sửa kịch bản: ${dto.comment}`,
        );
        return this.find(projectId, tx);
      }
      await this.decide(tx, version, projectId, ScriptReviewStage.ADMIN, dto, admin.id, ScriptStatus.FINAL);
      if (dto.studioId) await tx.movieProject.update({ where: { id: projectId }, data: { studioId: dto.studioId } });
      await this.record(tx, project, CONTENT_EVENT.SCRIPT_FINALIZED, admin.id, { version });
      await this.tell(
        tx,
        [project.creatorId, project.reviewerId],
        project,
        `Admin đã duyệt Kịch bản Final (bản ${version}); hệ thống gửi hợp đồng mẫu cho Studio.`,
      );
      await this.contracts.sendTemplate(tx, projectId, admin.id, dto.terms);
      return this.find(projectId, tx);
    });
  }

  private assertAssigned(project: TitledProject): void {
    if (project.status !== ProjectStatus.ASSIGNED) {
      throw new ConflictException(`The script is worked on while the project is ASSIGNED, not ${project.status}`);
    }
  }

  /** The studio must be chosen and every episode planned with its deadline before the studio is contracted. */
  private async assertReadyForStudio(project: TitledProject, studioId?: string): Promise<void> {
    if (studioId) await this.studios.assertUsable(studioId);
    else if (!project.studioId) throw new ConflictException('Pick the studio to send the contract to (studioId)');
    const [episodes, undated] = await Promise.all([
      this.prisma.episode.count({ where: { movieId: project.id } }),
      this.prisma.episode.count({ where: { movieId: project.id, deliveryDeadline: null } }),
    ]);
    if (!episodes) throw new ConflictException('The Reviewer must plan at least one episode first');
    if (undated) throw new ConflictException('Every episode needs a delivery deadline before the studio is contracted');
  }

  /** The script, row-locked, in the expected status: a double click cannot review the same version twice. */
  private async locked(tx: PrismaTx, projectId: string, expected: ScriptStatus) {
    await tx.$queryRaw`SELECT project_id FROM project_scripts WHERE project_id = ${projectId}::uuid FOR UPDATE`;
    const script = await tx.projectScript.findUnique({ where: { projectId } });
    if (script?.status !== expected) {
      throw new ConflictException(`The script is ${script?.status ?? 'not submitted yet'} (expected ${expected})`);
    }
    return script;
  }

  private async decide(
    tx: PrismaTx,
    version: number,
    projectId: string,
    stage: ScriptReviewStage,
    dto: ReviewScriptRequestDto,
    reviewerId: string,
    status: ScriptStatus,
  ): Promise<void> {
    await tx.scriptReview.create({
      data: { projectId, version, stage, approved: dto.approve, comment: dto.comment || null, reviewerId },
    });
    await tx.projectScript.update({
      where: { projectId },
      data: { status, finalizedAt: status === ScriptStatus.FINAL ? new Date() : null },
    });
    const action = dto.approve ? CONTENT_EVENT.SCRIPT_REVIEWED : CONTENT_EVENT.SCRIPT_REVISION_REQUESTED;
    await this.record(tx, { id: projectId }, action, reviewerId, { version, stage, comment: dto.comment });
  }

  private tell(tx: PrismaTx, to: (string | null)[], project: TitledProject, body: string) {
    return this.notifications.notify(
      to.filter((id): id is string => !!id),
      {
        type: NOTIFICATION_TYPE.SCRIPT_UPDATED,
        title: `Kịch bản phim "${project.movie.title}" có cập nhật`,
        body,
        link: `/projects/${project.id}/script`,
        payload: { projectId: project.id },
      },
      tx,
    );
  }

  private record(
    tx: PrismaTx,
    project: { id: string },
    action: ContentEvent,
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      { action, entityType: 'ProjectScript', entityId: project.id, projectId: project.id, actorId, payload },
      tx,
    );
  }
}
