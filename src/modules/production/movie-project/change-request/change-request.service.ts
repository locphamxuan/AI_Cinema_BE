import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ChangeRequestStatus, ChangeRequestType, ProjectStatus, UserRole, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus } from 'src/modules/production/project-access/project-rules';
import { ReviewerTokenService } from 'src/modules/production/reviewer-token/reviewer-token.service';
import type { ProposeChangeRequestDto, ResolveChangeRequestDto } from './dto/change-request.request.dto';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';

const PERSON = { select: { id: true, fullName: true } } as const;

/** BR-55: PDF, DOCX, TXT or images, at most 10 MB. */
export const CHANGE_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const PROOF_KINDS = [FILE_KINDS.pdf, FILE_KINDS.docx, FILE_KINDS.txt, FILE_KINDS.png, FILE_KINDS.jpeg, FILE_KINDS.webp];

const LIVE_PROJECT: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.ASSIGNED,
  ProjectStatus.IN_PRODUCTION,
  ProjectStatus.COMPLETED,
  ProjectStatus.UNDER_REVISION,
];

const DETAIL = {
  requestedBy: PERSON,
  resolvedBy: PERSON,
  season: { select: { id: true, seasonNumber: true, title: true } },
  episode: { select: { id: true, episodeNumber: true, title: true } },
} satisfies Prisma.ProjectChangeRequestInclude;

/**
 * BR-55: the Reviewer in charge or a Creator of the team asks the Admin to change a project, giving the
 * reason and proof; only the Admin decides. A budget supplement that is approved is granted to the
 * project's Reviewer in the same step.
 */
@Injectable()
export class ChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly storage: ObjectStorage,
    private readonly budgets: ReviewerTokenService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async propose(
    projectId: string,
    dto: ProposeChangeRequestDto,
    proof: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ) {
    const project = await this.access.project(projectId, user, 'read');
    if (project.reviewerId !== user.id && !(await this.access.isOnTeam(project, user.id))) {
      throw new ForbiddenException('Only the Reviewer or a Creator of this project can send a change request');
    }
    assertProjectStatus(project.status, LIVE_PROJECT, 'send a change request');
    const requestType = dto.requestType ?? ChangeRequestType.PROJECT_UPDATE;
    this.assertTokens(requestType, dto.requestedTokens, proof);
    await this.assertScope(projectId, dto);
    const attachment = proof ? await this.storeProof(projectId, proof) : null;

    return this.prisma
      .$transaction(async (tx) => {
        const request = await tx.projectChangeRequest.create({
          data: {
            projectId,
            seasonId: dto.seasonId,
            episodeId: dto.episodeId,
            requestedById: user.id,
            requestType,
            content: dto.content.trim(),
            reason: dto.reason.trim(),
            requestedTokens: dto.requestedTokens === undefined ? undefined : BigInt(dto.requestedTokens),
            ...(attachment ?? {}),
          },
          include: DETAIL,
        });
        const admins = await tx.user.findMany({
          where: { role: UserRole.ADMIN, isActive: true },
          select: { id: true },
        });
        const watchers = [...admins.map((a) => a.id), project.reviewerId].filter((id) => id !== user.id);
        await this.notifications.notify(
          watchers,
          {
            type: NOTIFICATION_TYPE.CHANGE_REQUESTED,
            title: `Đề xuất mới cho phim "${project.movie.title}"`,
            body: dto.content,
            link: `/projects/${projectId}/change-requests`,
            payload: { projectId, changeRequestId: request.id, requestType },
          },
          tx,
        );
        await this.auditLog.record(
          {
            action: CONTENT_EVENT.PROJECT_CHANGE_REQUESTED,
            entityType: 'ProjectChangeRequest',
            entityId: request.id,
            projectId,
            actorId: user.id,
            payload: { requestType, requestedTokens: dto.requestedTokens ?? null },
          },
          tx,
        );
        return request;
      })
      .catch(async (error: unknown) => {
        if (attachment) await this.storage.remove(attachment.attachmentKey, 'private').catch(() => undefined);
        throw error;
      });
  }

  async list(projectId: string, user: AuthenticatedUser) {
    await this.access.project(projectId, user, 'read');
    return this.prisma.projectChangeRequest.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: DETAIL,
    });
  }

  /** The Admin's inbox: requests of every project, the open ones first. */
  inbox(status?: ChangeRequestStatus) {
    return this.prisma.projectChangeRequest.findMany({
      where: { status },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { ...DETAIL, project: PROJECT_REF },
    });
  }

  async proof(changeRequestId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    const request = await this.prisma.projectChangeRequest.findUnique({ where: { id: changeRequestId } });
    if (!request?.attachmentKey) throw new NotFoundException('Proof not found');
    await this.access.project(request.projectId, user, 'read');
    return new StreamableFile(await this.storage.stream(request.attachmentKey, 'private'), {
      type: request.attachmentMimeType ?? 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(request.attachmentName ?? 'proof')}`,
    });
  }

  async resolve(changeRequestId: string, approve: boolean, dto: ResolveChangeRequestDto, admin: AuthenticatedUser) {
    const request = await this.prisma.projectChangeRequest.findUnique({
      where: { id: changeRequestId },
      include: { project: PROJECT_REF },
    });
    if (!request) throw new NotFoundException('Change request not found');
    const response = dto.response?.trim() || null;
    if (!approve && !response) throw new BadRequestException('Explain why the request is rejected');

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.projectChangeRequest.updateMany({
        where: { id: changeRequestId, status: ChangeRequestStatus.OPEN },
        data: {
          status: approve ? ChangeRequestStatus.APPROVED : ChangeRequestStatus.REJECTED,
          adminResponse: response,
          resolvedById: admin.id,
          resolvedAt: new Date(),
        },
      });
      if (count === 0) throw new ConflictException('This change request was already answered');
      if (approve && request.requestType === ChangeRequestType.BUDGET_SUPPLEMENT && request.requestedTokens) {
        const reason = `Duyệt đề xuất bổ sung ngân sách cho phim "${request.project.movie.title}"`;
        await this.budgets.grantWithin(tx, request.project.reviewerId, Number(request.requestedTokens), reason, admin);
      }
      await this.notifications.notify(
        [...new Set([request.requestedById, request.project.reviewerId])],
        {
          type: NOTIFICATION_TYPE.CHANGE_RESOLVED,
          title: `Đề xuất cho phim "${request.project.movie.title}" đã được ${approve ? 'chấp nhận' : 'từ chối'}`,
          body: response ?? undefined,
          link: `/projects/${request.projectId}/change-requests`,
          payload: { projectId: request.projectId, changeRequestId },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: approve ? CONTENT_EVENT.PROJECT_CHANGE_APPROVED : CONTENT_EVENT.PROJECT_CHANGE_REJECTED,
          entityType: 'ProjectChangeRequest',
          entityId: changeRequestId,
          projectId: request.projectId,
          actorId: admin.id,
          payload: { response },
        },
        tx,
      );
      return tx.projectChangeRequest.findUniqueOrThrow({ where: { id: changeRequestId }, include: DETAIL });
    });
  }

  private assertTokens(type: ChangeRequestType, tokens: number | undefined, proof: Express.Multer.File | undefined) {
    if (type === ChangeRequestType.BUDGET_SUPPLEMENT) {
      if (!tokens) throw new BadRequestException('A budget supplement states the Token asked for (requestedTokens)');
      if (!proof) throw new BadRequestException('A budget supplement needs proof attached (e.g. the studio quote)');
    } else if (tokens !== undefined) {
      throw new BadRequestException('Only a budget supplement asks for Token');
    }
  }

  private async assertScope(projectId: string, dto: ProposeChangeRequestDto) {
    if (dto.seasonId && !(await this.prisma.season.count({ where: { id: dto.seasonId, movieId: projectId } }))) {
      throw new BadRequestException('The season does not belong to this project');
    }
    if (dto.episodeId && !(await this.prisma.episode.count({ where: { id: dto.episodeId, movieId: projectId } }))) {
      throw new BadRequestException('The episode does not belong to this project');
    }
  }

  private async storeProof(projectId: string, file: Express.Multer.File) {
    if (!file.size) throw new BadRequestException('The proof file is empty');
    const attachmentName = safeFileName(file.originalname);
    const kind = detectKind(attachmentName, file.buffer.subarray(0, 16), PROOF_KINDS);
    const attachmentKey = `movies/${projectId}/change-requests/${randomUUID()}${kind.extensions[0]}`;
    await this.storage.putBuffer(attachmentKey, file.buffer, kind.mimeType, 'private');
    return { attachmentName, attachmentKey, attachmentMimeType: kind.mimeType };
  }
}
