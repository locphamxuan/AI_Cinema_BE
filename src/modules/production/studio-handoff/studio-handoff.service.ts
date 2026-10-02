import { ConflictException, Inject, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { EpisodeStatus, MovieStatus, StudioResponse } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { businessDay } from 'src/common/time/business-day';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { EMAIL_TEMPLATE, EmailOutboxService } from 'src/modules/platform/email/email-outbox.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { assertProjectStatus, DELIVERY_PROJECT_STATUSES } from 'src/modules/production/project-access/project-rules';
import { BriefService, type PreparedBrief, type StudioInfo } from './brief/brief.service';
import type { ChangeStudioRequestDto, HandOffRequestDto } from './dto/studio-handoff.request.dto';
import { newPortalToken, portalEmailLines, portalUrl } from './portal-token';

/** MF-1 steps 3–4: hand the project to a studio outside the platform, or change studio (BR-13, BR-38). */
@Injectable()
export class StudioHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly briefs: BriefService,
    private readonly emails: EmailOutboxService,
    private readonly storage: ObjectStorage,
    private readonly auditLog: AuditLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handOff(movieId: string, dto: HandOffRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, [MovieStatus.ASSIGNED], 'hand the project off');
    const dueDates = await this.deadlines(movieId);

    const brief = await this.briefs.prepare(movieId, dto, dueDates);
    const emailId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.movie.updateMany({
        where: { id: movieId, status: MovieStatus.ASSIGNED },
        data: { ...this.studioColumns(dto), status: MovieStatus.IN_PRODUCTION, handedOffAt: new Date() },
      });
      if (count === 0) throw new ConflictException('The project changed meanwhile; reload it');
      for (const [episodeId, dueDate] of dueDates) {
        await tx.episode.update({ where: { id: episodeId }, data: { dueDate, status: EpisodeStatus.AWAITING_MEDIA } });
      }
      return this.recordHandoff(tx, movieId, dto, brief, user, null);
    });
    await this.emails.dispatch(emailId);
    return this.history(movieId, user);
  }

  async changeStudio(movieId: string, dto: ChangeStudioRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, DELIVERY_PROJECT_STATUSES, 'change the studio');
    const brief = await this.briefs.prepare(movieId, dto);
    const emailId = await this.prisma.$transaction(async (tx) => {
      await tx.movie.update({ where: { id: movieId }, data: this.studioColumns(dto) });
      return this.recordHandoff(tx, movieId, dto, brief, user, dto.reason.trim());
    });
    await this.emails.dispatch(emailId);
    return this.history(movieId, user);
  }

  /** A new portal link for the current studio, e.g. when the email got lost; the old link stops working. */
  async resendPortalLink(movieId: string, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, DELIVERY_PROJECT_STATUSES, 'send the studio link');
    const current = await this.prisma.studioHandoff.findFirst({ where: { movieId }, orderBy: { createdAt: 'desc' } });
    if (!current) throw new ConflictException('The project has not been handed off yet');
    if (current.studioResponse === StudioResponse.DECLINED) {
      throw new ConflictException('The studio declined the project; change the studio instead');
    }

    const portal = newPortalToken();
    const emailId = await this.prisma.$transaction(async (tx) => {
      await tx.studioHandoff.update({
        where: { id: current.id },
        data: { portalTokenHash: portal.hash, portalRevokedAt: null },
      });
      const id = await this.emails.create(tx, {
        to: current.studioEmail,
        template: EMAIL_TEMPLATE.STUDIO_PORTAL_LINK,
        subject: `[AI Cinema] Link cổng studio mới cho phim "${movie.title}"`,
        text: [
          `Kính gửi ${current.studioName},`,
          '',
          'Link cổng studio trước đây đã được thay bằng link dưới đây.',
          ...portalEmailLines(portalUrl(this.config.webAppUrl, portal.token)),
        ].join('\n'),
        attachments: [],
        notifyOnFailureId: user.id,
        link: `/projects/${movieId}/studio`,
      });
      await this.auditLog.record(
        {
          action: CONTENT_EVENT.STUDIO_LINK_RESENT,
          entityType: 'StudioHandoff',
          entityId: current.id,
          movieId,
          actorId: user.id,
          payload: { studioEmail: current.studioEmail },
        },
        tx,
      );
      return id;
    });
    await this.emails.dispatch(emailId);
    return this.history(movieId, user);
  }

  /** Hand-offs, newest first; the link's hash never leaves the server, only whether it still works. */
  async history(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    const handoffs = await this.prisma.studioHandoff.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        emailMessage: { select: { status: true, sentAt: true, errorMessage: true } },
      },
    });
    return handoffs.map(({ portalTokenHash, ...handoff }) => ({
      ...handoff,
      portalActive: portalTokenHash !== null && handoff.portalRevokedAt === null,
    }));
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

  private async recordHandoff(
    tx: PrismaTx,
    movieId: string,
    studio: StudioInfo,
    brief: PreparedBrief,
    user: AuthenticatedUser,
    changeReason: string | null,
  ): Promise<string> {
    // One studio at a time: the previous studio's link stops working with this hand-off.
    await tx.studioHandoff.updateMany({
      where: { movieId, portalRevokedAt: null, portalTokenHash: { not: null } },
      data: { portalRevokedAt: new Date() },
    });
    const portal = newPortalToken();
    const emailId = await this.emails.create(tx, {
      to: studio.studioEmail,
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      subject: brief.subject,
      text: [brief.text, '', ...portalEmailLines(portalUrl(this.config.webAppUrl, portal.token))].join('\n'),
      attachments: brief.attachments,
      notifyOnFailureId: user.id,
      link: `/projects/${movieId}/studio`,
    });
    const handoff = await tx.studioHandoff.create({
      data: {
        movieId,
        ...this.studioColumns(studio),
        productionFeeTokens: BigInt(brief.productionFeeTokens),
        changeReason,
        briefFileKey: brief.briefKey,
        emailMessageId: emailId,
        createdById: user.id,
        portalTokenHash: portal.hash,
      },
    });
    await this.auditLog.record(
      {
        action: changeReason ? CONTENT_EVENT.STUDIO_CHANGED : CONTENT_EVENT.STUDIO_HANDOFF_SENT,
        entityType: 'StudioHandoff',
        entityId: handoff.id,
        movieId,
        actorId: user.id,
        payload: { studioName: studio.studioName, studioEmail: studio.studioEmail, reason: changeReason },
      },
      tx,
    );
    return emailId;
  }

  private studioColumns(studio: StudioInfo) {
    return {
      studioName: studio.studioName.trim(),
      studioEmail: studio.studioEmail.trim().toLowerCase(),
      studioContact: studio.studioContact?.trim() || null,
    };
  }

  /**
   * The studio is due on the Reviewer's deadline of each episode (BR-38); a deadline already past must be
   * moved by the Reviewer before the hand-off.
   */
  private async deadlines(movieId: string): Promise<Map<string, Date>> {
    const episodes = await this.prisma.episode.findMany({
      where: { movieId },
      orderBy: { episodeNumber: 'asc' },
      select: { id: true, episodeNumber: true, milestoneDate: true },
    });
    const today = businessDay();
    const late = episodes.filter((e) => !e.milestoneDate || e.milestoneDate < today).map((e) => e.episodeNumber);
    if (late.length) {
      throw new ConflictException(
        `Episodes ${late.join(', ')} have no deadline or one already past; the Reviewer must set it first`,
      );
    }
    return new Map(episodes.map((e) => [e.id, e.milestoneDate!]));
  }
}
