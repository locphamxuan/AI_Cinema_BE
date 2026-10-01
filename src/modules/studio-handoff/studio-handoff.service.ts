import { BadRequestException, ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { EpisodeStatus, MovieStatus } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/audit-log/content-events';
import { EMAIL_TEMPLATE, EmailOutboxService } from 'src/modules/email/email-outbox.service';
import { ProjectAccessService } from 'src/modules/project-access/project-access.service';
import { assertProjectStatus } from 'src/modules/project-access/project-rules';
import { BriefService, type PreparedBrief, type StudioInfo } from './brief.service';
import type { ChangeStudioRequestDto, EpisodeDueDateDto, HandOffRequestDto } from './dto/studio-handoff.request.dto';

const today = () => new Date(new Date().toISOString().slice(0, 10));

// Deadlines can move while the studio has not delivered an accepted version yet.
const DEADLINE_STATUSES: EpisodeStatus[] = [
  EpisodeStatus.DRAFT,
  EpisodeStatus.AWAITING_MEDIA,
  EpisodeStatus.PROCESSING,
  EpisodeStatus.IN_REVIEW,
  EpisodeStatus.CHANGES_REQUESTED,
];

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
  ) {}

  async handOff(movieId: string, dto: HandOffRequestDto, user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, [MovieStatus.ASSIGNED], 'hand the project off');
    const episodeIds = (await this.prisma.episode.findMany({ where: { movieId }, select: { id: true } })).map(
      (e) => e.id,
    );
    const dueDates = this.parseDueDates(dto.dueDates, episodeIds);
    if (dueDates.size !== episodeIds.length) throw new BadRequestException('Give a due date for every episode');

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
    assertProjectStatus(movie.status, [MovieStatus.IN_PRODUCTION], 'change the studio');
    const brief = await this.briefs.prepare(movieId, dto);
    const emailId = await this.prisma.$transaction(async (tx) => {
      await tx.movie.update({ where: { id: movieId }, data: this.studioColumns(dto) });
      return this.recordHandoff(tx, movieId, dto, brief, user, dto.reason.trim());
    });
    await this.emails.dispatch(emailId);
    return this.history(movieId, user);
  }

  /** Deadlines of episodes added after the hand-off, or moved with the studio. */
  async setDueDates(movieId: string, dueDates: EpisodeDueDateDto[], user: AuthenticatedUser) {
    const movie = await this.access.movie(movieId, user, 'creator');
    assertProjectStatus(movie.status, [MovieStatus.IN_PRODUCTION], 'set due dates');
    const episodes = await this.prisma.episode.findMany({ where: { movieId }, select: { id: true, status: true } });
    const parsed = this.parseDueDates(
      dueDates,
      episodes.map((e) => e.id),
    );
    const locked = episodes.filter((e) => parsed.has(e.id) && !DEADLINE_STATUSES.includes(e.status));
    if (locked.length) throw new ConflictException('An approved episode no longer has a deadline to move');

    await this.prisma.$transaction(
      [...parsed].map(([id, dueDate]) => this.prisma.episode.update({ where: { id }, data: { dueDate } })),
    );
    return this.prisma.episode.findMany({ where: { movieId }, orderBy: { episodeNumber: 'asc' } });
  }

  async history(movieId: string, user: AuthenticatedUser) {
    await this.access.movie(movieId, user, 'read');
    return this.prisma.studioHandoff.findMany({
      where: { movieId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        emailMessage: { select: { status: true, sentAt: true, errorMessage: true } },
      },
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

  private async recordHandoff(
    tx: PrismaTx,
    movieId: string,
    studio: StudioInfo,
    brief: PreparedBrief,
    user: AuthenticatedUser,
    changeReason: string | null,
  ): Promise<string> {
    const emailId = await this.emails.create(tx, {
      to: studio.studioEmail,
      template: EMAIL_TEMPLATE.STUDIO_BRIEF,
      subject: brief.subject,
      text: brief.text,
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

  private parseDueDates(entries: EpisodeDueDateDto[], episodeIds: string[]): Map<string, Date> {
    const parsed = new Map<string, Date>();
    for (const { episodeId, dueDate } of entries) {
      if (!episodeIds.includes(episodeId)) throw new BadRequestException(`Episode ${episodeId} is not in this project`);
      const date = new Date(dueDate);
      if (date < today()) throw new BadRequestException('A due date cannot be in the past');
      parsed.set(episodeId, date);
    }
    return parsed;
  }
}
