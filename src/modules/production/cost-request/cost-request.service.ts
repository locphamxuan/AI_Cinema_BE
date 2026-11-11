import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { CostRequestStatus, ProjectStatus, StudioMilestoneStatus, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { detectKind, FILE_KINDS, safeFileName } from 'src/common/validation/uploaded-file';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { removeQuietly } from 'src/infrastructure/storage/remove-quietly';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT, type ContentEvent } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProductionCostService } from 'src/modules/production/production-cost/production-cost.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { PROJECT_REF } from 'src/modules/production/project-access/project-relations';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import type { CostRequestListQueryDto, CreateCostRequestDto } from './dto/cost-request.request.dto';

/** The studio quote or another proof: PDF, DOCX, TXT or an image, at most 10 MB. */
export const COST_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const PROOF_KINDS = [FILE_KINDS.pdf, FILE_KINDS.docx, FILE_KINDS.txt, FILE_KINDS.png, FILE_KINDS.jpeg, FILE_KINDS.webp];

const PERSON = { select: { id: true, fullName: true } } as const;
const DETAIL = {
  project: PROJECT_REF,
  handoff: {
    select: { id: true, offeredFeeVnd: true, milestoneStatus: true, studio: { select: { id: true, name: true } } },
  },
  requestedBy: PERSON,
  resolvedBy: PERSON,
} satisfies Prisma.ProductionCostRequestInclude;

type Detailed = Prisma.ProductionCostRequestGetPayload<{ include: typeof DETAIL }>;

const vnd = (amount: number | bigint) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/**
 * "Yêu cầu thêm chi phí sản xuất": when a studio wants more than the budget left, the project's Reviewer asks
 * the Admin, with the studio quote attached. The Admin grants it (possibly less than asked, booked as an
 * ADDITIONAL cost entry in the same transaction) or refuses with a reason. One open request per project.
 */
@Injectable()
export class CostRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly costs: ProductionCostService,
    private readonly storage: ObjectStorage,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(
    projectId: string,
    dto: CreateCostRequestDto,
    proof: Express.Multer.File | undefined,
    user: AuthenticatedUser,
  ) {
    const project = await this.access.project(projectId, user, 'reviewer');
    assertProjectStatus(
      project.status,
      [...OPEN_PROJECT_STATUSES, ProjectStatus.UNDER_REVISION],
      'ask for more production cost',
    );
    if (!proof) throw new BadRequestException('Attach the studio quote or another proof (proof)');
    if (dto.handoffId) await this.assertHandoff(projectId, dto.handoffId);
    const attachment = await this.storeProof(projectId, proof);

    return this.prisma
      .$transaction(async (tx) => {
        await this.costs.lock(tx, projectId);
        const open = await tx.productionCostRequest.count({ where: { projectId, status: CostRequestStatus.OPEN } });
        if (open) throw new ConflictException('This project already has an open cost request; wait for the answer');
        const request = await tx.productionCostRequest.create({
          data: {
            projectId,
            handoffId: dto.handoffId,
            requestedById: user.id,
            requestedVnd: BigInt(dto.requestedVnd),
            studioQuoteVnd: dto.studioQuoteVnd === undefined ? undefined : BigInt(dto.studioQuoteVnd),
            reason: dto.reason.trim(),
            ...attachment,
          },
          include: DETAIL,
        });
        await this.notifications.notify(
          await this.notifications.adminIds(tx),
          {
            type: NOTIFICATION_TYPE.COST_REQUESTED,
            title: `Reviewer xin thêm ${vnd(dto.requestedVnd)} chi phí sản xuất cho phim "${project.movie.title}"`,
            body: dto.reason,
            link: '/admin/requests',
            payload: { projectId, costRequestId: request.id, requestedVnd: dto.requestedVnd },
          },
          tx,
        );
        await this.record(tx, request, CONTENT_EVENT.COST_REQUESTED, user.id, {
          requestedVnd: dto.requestedVnd,
          studioQuoteVnd: dto.studioQuoteVnd ?? null,
        });
        return request;
      })
      .catch(async (error: unknown) => {
        await removeQuietly(this.storage, attachment.attachmentKey, 'private');
        throw error;
      });
  }

  /** A project's requests, or the inbox: every request for the Admin, the Reviewer's own projects otherwise. */
  async list(query: CostRequestListQueryDto, user: AuthenticatedUser, projectId?: string) {
    if (projectId) await this.access.project(projectId, user, 'read');
    const where: Prisma.ProductionCostRequestWhereInput = {
      ...(projectId ? { projectId } : { project: await this.access.readableWhere(user) }),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [data, total] = await Promise.all([
      this.prisma.productionCostRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: DETAIL,
      }),
      this.prisma.productionCostRequest.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async proof(requestId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    const request = await this.prisma.productionCostRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Cost request not found');
    await this.access.project(request.projectId, user, 'read');
    if (!request.attachmentKey) throw new NotFoundException('This request has no proof');
    return new StreamableFile(await this.storage.stream(request.attachmentKey, 'private'), {
      type: request.attachmentMimeType ?? 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(request.attachmentName ?? 'proof')}`,
    });
  }

  async approve(
    requestId: string,
    grantedVnd: number | undefined,
    response: string | undefined,
    admin: AuthenticatedUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.openRequest(tx, requestId);
      const granted = grantedVnd ?? Number(request.requestedVnd);
      if (granted > Number(request.requestedVnd)) {
        throw new BadRequestException('You cannot grant more than the Reviewer asked for');
      }
      const note = response?.trim() || null;
      await tx.productionCostRequest.update({
        where: { id: requestId },
        data: {
          status: CostRequestStatus.APPROVED,
          grantedVnd: BigInt(granted),
          adminResponse: note,
          resolvedById: admin.id,
          resolvedAt: new Date(),
        },
      });
      const reason = `Duyệt yêu cầu thêm chi phí sản xuất: ${request.reason}`;
      await this.costs.grant(tx, request, granted, reason, admin.id);
      const partly = granted < Number(request.requestedVnd) ? ` (xin ${vnd(request.requestedVnd)})` : '';
      await this.answered(tx, request, true, `Admin cấp ${vnd(granted)}${partly}${note ? `. ${note}` : ''}`, admin);
      return tx.productionCostRequest.findUniqueOrThrow({ where: { id: requestId }, include: DETAIL });
    });
  }

  async reject(requestId: string, response: string, admin: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.openRequest(tx, requestId);
      await tx.productionCostRequest.update({
        where: { id: requestId },
        data: {
          status: CostRequestStatus.REJECTED,
          adminResponse: response.trim(),
          resolvedById: admin.id,
          resolvedAt: new Date(),
        },
      });
      await this.answered(tx, request, false, `Admin từ chối: ${response.trim()}`, admin);
      return tx.productionCostRequest.findUniqueOrThrow({ where: { id: requestId }, include: DETAIL });
    });
  }

  /** The request, still open, with its project locked so a double click cannot answer it twice. */
  private async openRequest(tx: PrismaTx, requestId: string): Promise<Detailed> {
    const found = await tx.productionCostRequest.findUnique({ where: { id: requestId }, select: { projectId: true } });
    if (!found) throw new NotFoundException('Cost request not found');
    await this.costs.lock(tx, found.projectId);
    const request = await tx.productionCostRequest.findUniqueOrThrow({ where: { id: requestId }, include: DETAIL });
    if (request.status !== CostRequestStatus.OPEN) throw new ConflictException('This request was already answered');
    return request;
  }

  private async assertHandoff(projectId: string, handoffId: string) {
    const handoff = await this.prisma.studioHandoff.findFirst({ where: { id: handoffId, projectId } });
    if (!handoff) throw new BadRequestException('The hand-off does not belong to this project');
    if (handoff.milestoneStatus === StudioMilestoneStatus.SUPERSEDED) {
      throw new ConflictException('That hand-off was replaced by another studio');
    }
  }

  private async answered(tx: PrismaTx, request: Detailed, approved: boolean, body: string, admin: AuthenticatedUser) {
    const title = request.project.movie.title;
    await this.notifications.notify(
      [...new Set([request.requestedById, request.project.reviewerId])],
      {
        type: approved ? NOTIFICATION_TYPE.COST_REQUEST_APPROVED : NOTIFICATION_TYPE.COST_REQUEST_REJECTED,
        title: `Yêu cầu thêm chi phí sản xuất phim "${title}" ${approved ? 'được duyệt' : 'bị từ chối'}`,
        body,
        link: `/projects/${request.projectId}/fee`,
        payload: { projectId: request.projectId, costRequestId: request.id },
      },
      tx,
    );
    await this.record(
      tx,
      request,
      approved ? CONTENT_EVENT.COST_REQUEST_APPROVED : CONTENT_EVENT.COST_REQUEST_REJECTED,
      admin.id,
      { body },
    );
  }

  private record(
    tx: PrismaTx,
    request: { id: string; projectId: string },
    action: ContentEvent,
    actorId: string,
    payload: Record<string, unknown>,
  ) {
    return this.auditLog.record(
      {
        action,
        entityType: 'ProductionCostRequest',
        entityId: request.id,
        projectId: request.projectId,
        actorId,
        payload,
      },
      tx,
    );
  }

  private async storeProof(projectId: string, file: Express.Multer.File) {
    if (!file.size) throw new BadRequestException('The proof file is empty');
    const attachmentName = safeFileName(file.originalname);
    const kind = detectKind(attachmentName, file.buffer.subarray(0, 16), PROOF_KINDS);
    const attachmentKey = `movies/${projectId}/cost-requests/${randomUUID()}${kind.extensions[0]}`;
    await this.storage.putBuffer(attachmentKey, file.buffer, kind.mimeType, 'private');
    return { attachmentName, attachmentKey, attachmentMimeType: kind.mimeType };
  }
}
