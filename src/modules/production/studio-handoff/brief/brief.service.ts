import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { EmailAttachment } from 'src/modules/platform/email/email-outbox.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import type { StoredMaterial } from '../material/handoff-material.service';
import { briefFont, type BriefContent, renderBriefPdf } from './brief-pdf';
import { briefTeam, briefTeamLines, personLine } from './brief-team';

const PERSON = { select: { id: true, fullName: true, email: true } } as const;

export interface BriefStudio {
  name: string;
  contactName: string | null;
}

/** Who the brief comes from and what replaced studios already cost: the fee it promises depends on both. */
export interface BriefContext {
  /** The Creator handing off: named as the studio's contact and where the film is mailed back. */
  senderId: string;
  /** Fee of the hand-offs this brief replaces, spent on the old studio (BR-59). */
  pendingLostTokens: number;
}

export interface PreparedBrief {
  briefKey: string;
  productionFeeTokens: number;
  subject: string;
  text: string;
  attachments: EmailAttachment[];
  /** The Creator the brief comes from: shown as the sender, and where the studio's reply goes. */
  creatorName: string;
  creatorEmail: string;
}

/**
 * Builds the brief a studio receives (BR-13): the PDF is generated from the project as it is now, stored
 * privately, and sent with the latest version of every idea file and the material of the hand-off.
 */
@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);
  private readonly fontPath: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly fees: ProductionFeeService,
    private readonly settings: PlatformSettingService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fontPath = briefFont(config.briefFontPath);
    if (!this.fontPath) this.logger.warn('No font with Vietnamese glyphs found; briefs drop diacritics');
  }

  /** `seasonId` limits the brief to one season; null briefs every episode of the project. */
  async prepare(
    movieId: string,
    studio: BriefStudio,
    seasonId: string | null,
    materials: StoredMaterial[],
    context: BriefContext,
  ): Promise<PreparedBrief> {
    const productionFeeTokens = await this.fees.spendableTokens(movieId, seasonId, context.pendingLostTokens);
    if (productionFeeTokens <= 0) {
      throw new ConflictException(
        'No production fee is left for this scope: earlier studios used it up. Ask the Reviewer for more Token first',
      );
    }
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: context.senderId },
      select: { fullName: true, email: true },
    });
    const movie = await this.prisma.movie.findUniqueOrThrow({
      where: { id: movieId },
      include: {
        genres: { include: { genre: { select: { name: true } } } },
        creator: PERSON,
        episodes: {
          where: seasonId ? { seasonId } : {},
          orderBy: { episodeNumber: 'asc' },
          include: { season: { select: { seasonNumber: true } }, assignedCreator: PERSON },
        },
        ideaFiles: { where: { purpose: 'IDEA' }, orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
      },
    });
    const latestIdeaFiles = movie.ideaFiles.filter(
      (file, i, all) => all.findIndex((other) => other.fileName === file.fileName) === i,
    );
    const { tokenRateVnd } = await this.settings.get();
    const team = briefTeam(
      movie.episodes.map((episode) => ({ ...episode, seasonNumber: episode.season.seasonNumber })),
      movie.creator,
      context.senderId,
    );

    const content: BriefContent = {
      movieTitle: movie.title,
      scope: seasonId ? `Mùa ${movie.episodes[0]?.season.seasonNumber ?? ''}` : 'Toàn bộ dự án',
      studioName: studio.name,
      studioContact: studio.contactName,
      creatorName: sender.fullName,
      creatorEmail: sender.email,
      coSenders: team.coSenders.map(personLine),
      ideaDescription: movie.ideaDescription,
      genres: movie.genres.map(({ genre }) => genre.name),
      productionFeeTokens,
      tokenRateVnd,
      episodes: movie.episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.season.seasonNumber,
        title: episode.title,
        targetDurationSeconds: episode.targetDurationSeconds,
        dueDate: episode.deliveryDeadline,
        owner: (episode.assignedCreator ?? movie.creator)?.fullName ?? null,
      })),
      ideaFiles: [...latestIdeaFiles.map((file) => file.fileName), ...materials.map((file) => file.fileName)],
      issuedAt: new Date(),
    };

    const briefKey = `movies/${movieId}/briefs/${randomUUID()}.pdf`;
    await this.storage.putBuffer(briefKey, await renderBriefPdf(content, this.fontPath), 'application/pdf', 'private');

    return {
      briefKey,
      productionFeeTokens,
      creatorName: content.creatorName,
      creatorEmail: content.creatorEmail,
      subject: `[AI Cinema] Đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope})`,
      text: [
        `Kính gửi ${studio.name},`,
        '',
        `AI Cinema gửi đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope}) gồm ${movie.episodes.length} tập.`,
        `Phí sản xuất: ${productionFeeTokens} Token (= ${productionFeeTokens * tokenRateVnd} VND).`,
        'Chi tiết từng tập và hạn giao nằm trong brief PDF đính kèm, kèm kịch bản và tài liệu tham khảo.',
        'Khi hoàn tất, vui lòng gửi phim đã soạn sẵn qua email cho đầu mối bên dưới.',
        '',
        `Đầu mối: ${content.creatorName} - ${content.creatorEmail}`,
        ...briefTeamLines(team),
      ].join('\n'),
      attachments: [
        { key: briefKey, fileName: `brief-${movieId}.pdf`, contentType: 'application/pdf' },
        ...latestIdeaFiles.map((file) => ({
          key: file.storageKey,
          fileName: file.fileName,
          contentType: file.mimeType,
        })),
        ...materials.map((file) => ({ key: file.storageKey, fileName: file.fileName, contentType: file.mimeType })),
      ],
    };
  }
}
