import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { EmailAttachment } from 'src/modules/platform/email/email-outbox.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { ProductionFeeService } from 'src/modules/production/production-fee/production-fee.service';
import { briefFont, type BriefContent, renderBriefPdf } from './brief-pdf';

export interface StudioInfo {
  studioName: string;
  studioEmail: string;
  studioContact?: string | null;
}

export interface PreparedBrief {
  briefKey: string;
  productionFeeTokens: number;
  subject: string;
  text: string;
  attachments: EmailAttachment[];
}

/**
 * Builds the brief a studio receives (BR-13): the PDF is generated from the project as it is
 * now, stored privately, and sent with the latest version of every idea file.
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

  /** `dueDates` overrides the stored deadlines (the hand-off sets them in the same request). */
  async prepare(movieId: string, studio: StudioInfo, dueDates: Map<string, Date> = new Map()): Promise<PreparedBrief> {
    const movie = await this.prisma.movie.findUniqueOrThrow({
      where: { id: movieId },
      include: {
        creator: { select: { fullName: true, email: true } },
        genres: { include: { genre: { select: { name: true } } } },
        episodes: { orderBy: { episodeNumber: 'asc' }, include: { season: { select: { seasonNumber: true } } } },
        ideaFiles: { orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
      },
    });
    const latestIdeaFiles = movie.ideaFiles.filter(
      (file, i, all) => all.findIndex((other) => other.fileName === file.fileName) === i,
    );
    const productionFeeTokens = await this.fees.totalTokens(movieId);
    const { tokenRateVnd } = await this.settings.get();

    const content: BriefContent = {
      movieTitle: movie.title,
      studioName: studio.studioName,
      studioContact: studio.studioContact ?? null,
      creatorName: movie.creator?.fullName ?? '',
      creatorEmail: movie.creator?.email ?? '',
      ideaDescription: movie.ideaDescription,
      genres: movie.genres.map(({ genre }) => genre.name),
      productionFeeTokens,
      tokenRateVnd,
      episodes: movie.episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.season.seasonNumber,
        title: episode.title,
        targetDurationSeconds: episode.targetDurationSeconds,
        dueDate: dueDates.get(episode.id) ?? episode.dueDate,
      })),
      ideaFiles: latestIdeaFiles.map((file) => file.fileName),
      issuedAt: new Date(),
    };

    const briefKey = `movies/${movieId}/briefs/${randomUUID()}.pdf`;
    await this.storage.putBuffer(briefKey, await renderBriefPdf(content, this.fontPath), 'application/pdf', 'private');

    return {
      briefKey,
      productionFeeTokens,
      subject: `[AI Cinema] Đơn đặt hàng sản xuất phim "${movie.title}"`,
      text: [
        `Kính gửi ${studio.studioName},`,
        '',
        `AI Cinema gửi đơn đặt hàng sản xuất phim "${movie.title}" gồm ${movie.episodes.length} tập.`,
        `Phí sản xuất: ${productionFeeTokens} Token (= ${productionFeeTokens * tokenRateVnd} VND).`,
        'Chi tiết từng tập và hạn giao nằm trong brief PDF đính kèm.',
        '',
        `Đầu mối: ${content.creatorName} — ${content.creatorEmail}`,
      ].join('\n'),
      attachments: [
        { key: briefKey, fileName: `brief-${movieId}.pdf`, contentType: 'application/pdf' },
        ...latestIdeaFiles.map((file) => ({
          key: file.storageKey,
          fileName: file.fileName,
          contentType: file.mimeType,
        })),
      ],
    };
  }
}
