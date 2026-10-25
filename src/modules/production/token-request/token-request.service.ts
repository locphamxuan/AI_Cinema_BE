import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MovieStatus, Prisma, TokenEntryType, TokenRequestStatus, UserRole } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { NOTIFICATION_TYPE } from 'src/modules/platform/notification/notification-types';
import { NotificationService } from 'src/modules/platform/notification/notification.service';
import { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, OPEN_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { CREATOR_REQUEST_REASON_PREFIX } from 'src/modules/production/reviewer-token/token-history';
import type { CreateTokenRequestDto, TokenRequestListQueryDto } from './dto/token-request.request.dto';

const DETAIL = {
  movie: { select: { id: true, title: true } },
  season: { select: { id: true, seasonNumber: true, title: true } },
  requestedBy: { select: { id: true, fullName: true, email: true } },
  resolvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.TokenRequestInclude;

/**
 * A Creator asks the project's Reviewer for more production-fee Token for a season (usually after the studio
 * refused the amount). The Reviewer grants it out of their own budget, as a TOP_UP on the season, or says no.
 */
@Injectable()
export class TokenRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly fees: ProductionFeeService,
    private readonly notifications: NotificationService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(movieId: string, dto: CreateTokenRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'lead');
    assertProjectStatus(movie.status, [...OPEN_PROJECT_STATUSES, MovieStatus.UNDER_REVISION], 'ask for more Token');
    const season = await this.prisma.season.findFirst({ where: { id: dto.seasonId, movieId } });
    if (!season) throw new BadRequestException('The season does not belong to this project');
    const open = await this.prisma.tokenRequest.count({
      where: { movieId, seasonId: season.id, requestedById: user.id, status: TokenRequestStatus.OPEN },
    });
    if (open) throw new ConflictException('You already have an open request for this season; wait for the answer');

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.tokenRequest.create({
        data: {
          movieId,
          seasonId: season.id,
          requestedById: user.id,
          requestedTokens: BigInt(dto.requestedTokens),
          reason: dto.reason.trim(),
        },
        include: DETAIL,
      });
      // The Reviewer answers; the Admin follows every request.
      await this.notifications.notify(
        [movie.reviewerId, ...(await this.notifications.adminIds(tx))],
        {
          type: NOTIFICATION_TYPE.TOKEN_REQUESTED,
          title: `${request.requestedBy.fullName} xin thêm ${dto.requestedTokens} Token cho phim "${movie.title}"`,
          body: dto.reason,
          link: `/projects/${movieId}/studio`,
          payload: { movieId, tokenRequestId: request.id, seasonId: season.id, requestedTokens: dto.requestedTokens },
        },
        tx,
      );
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.TOKEN_REQUESTED,
          entityType: 'TokenRequest',
          entityId: request.id,
          movieId,
          actorId: user.id,
          payload: { seasonId: season.id, requestedTokens: dto.requestedTokens },
        },
        tx,
      );
      return request;
    });
  }

  /** Requests the caller is part of: the Reviewer sees those on their projects, a Creator their own. */
  async list(query: TokenRequestListQueryDto, user: AuthenticatedUser, movieId?: string) {
    if (movieId) await this.access.movie(movieId, user, 'read');
    const followers: UserRole[] = [UserRole.CONTENT_REVIEWER, UserRole.CONTENT_CREATOR, UserRole.ADMIN];
    if (!followers.includes(user.role))
      throw new ForbiddenException('Token requests are for Reviewers, Creators and the Admin');
    const where: Prisma.TokenRequestWhereInput = {
      ...(movieId ? { movieId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(user.role === UserRole.CONTENT_REVIEWER
        ? { movie: { reviewerId: user.id } }
        : user.role === UserRole.CONTENT_CREATOR
          ? { requestedById: user.id }
          : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [data, total] = await Promise.all([
      this.prisma.tokenRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: DETAIL,
      }),
      this.prisma.tokenRequest.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async approve(requestId: string, grantedTokens: number | undefined, user: AuthenticatedUser) {
    const request = await this.ownedOpen(requestId, user);
    const granted = grantedTokens ?? Number(request.requestedTokens);
    if (granted > Number(request.requestedTokens)) {
      throw new BadRequestException('You cannot grant more than the Creator asked for');
    }
    // Claim it first so a double click cannot book the Token twice; the claim is undone if the fee is refused.
    const { count } = await this.prisma.tokenRequest.updateMany({
      where: { id: requestId, status: TokenRequestStatus.OPEN },
      data: {
        status: TokenRequestStatus.APPROVED,
        grantedTokens: BigInt(granted),
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('This request was already answered');
    try {
      await this.fees.addEntry(
        request.movieId,
        {
          entryType: TokenEntryType.TOP_UP,
          seasonId: request.seasonId,
          amountTokens: granted,
          reason: `${CREATOR_REQUEST_REASON_PREFIX} ${request.requestedBy.fullName}: ${request.reason}`,
        },
        user,
      );
    } catch (error) {
      await this.prisma.tokenRequest.update({
        where: { id: requestId },
        data: { status: TokenRequestStatus.OPEN, grantedTokens: null, resolvedById: null, resolvedAt: null },
      });
      throw error;
    }
    await this.answered(request, true, `Reviewer đã cấp ${granted} Token`, user);
    return this.prisma.tokenRequest.findUniqueOrThrow({ where: { id: requestId }, include: DETAIL });
  }

  async reject(requestId: string, response: string, user: AuthenticatedUser) {
    const request = await this.ownedOpen(requestId, user);
    const { count } = await this.prisma.tokenRequest.updateMany({
      where: { id: requestId, status: TokenRequestStatus.OPEN },
      data: {
        status: TokenRequestStatus.REJECTED,
        reviewerResponse: response.trim(),
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('This request was already answered');
    await this.answered(request, false, `Reviewer từ chối: ${response.trim()}`, user);
    return this.prisma.tokenRequest.findUniqueOrThrow({ where: { id: requestId }, include: DETAIL });
  }

  private async ownedOpen(requestId: string, user: AuthenticatedUser) {
    const request = await this.prisma.tokenRequest.findUnique({ where: { id: requestId }, include: DETAIL });
    if (!request) throw new NotFoundException('Token request not found');
    await this.access.movie(request.movieId, user, 'reviewer');
    if (request.status !== TokenRequestStatus.OPEN) throw new ConflictException('This request was already answered');
    return request;
  }

  private async answered(
    request: { id: string; movieId: string; movie: { title: string }; requestedById: string },
    approved: boolean,
    body: string,
    user: AuthenticatedUser,
  ) {
    await this.notifications.notify([request.requestedById, ...(await this.notifications.adminIds())], {
      type: approved ? NOTIFICATION_TYPE.TOKEN_REQUEST_APPROVED : NOTIFICATION_TYPE.TOKEN_REQUEST_REJECTED,
      title: approved
        ? `Yêu cầu thêm Token cho phim "${request.movie.title}" được chấp nhận`
        : `Yêu cầu thêm Token cho phim "${request.movie.title}" bị từ chối`,
      body,
      link: `/projects/${request.movieId}/studio`,
      payload: { movieId: request.movieId, tokenRequestId: request.id },
    });
    await this.auditLog.record({
      action: approved ? CONTENT_EVENT.TOKEN_REQUEST_APPROVED : CONTENT_EVENT.TOKEN_REQUEST_REJECTED,
      entityType: 'TokenRequest',
      entityId: request.id,
      movieId: request.movieId,
      actorId: user.id,
    });
  }
}
