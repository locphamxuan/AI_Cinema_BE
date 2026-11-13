import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { EmailAttachment } from 'src/modules/platform/email/email-outbox.service';
import { type BriefContent, formatVnd, renderBriefPdf } from './brief-pdf';

export interface BriefStudio {
  name: string;
  contactName: string | null;
}

/** Who the brief comes from and the fee it offers. */
export interface BriefContext {
  /** The Admin changing the studio: named in the PDF as the studio's contact. */
  senderId: string;
  /** Production fee (VND) offered to the studio, already checked against the budget left. */
  offeredFeeVnd: number;
}

export interface PreparedBrief {
  briefKey: string;
  offeredFeeVnd: number;
  subject: string;
  /** Body of the email; StudioMailService adds the greeting, the Studio Web link and the contact. */
  lines: string[];
  /** The brief PDF alone. */
  attachments: EmailAttachment[];
}

/**
 * Builds the brief a new studio receives when the Admin changes the studio: the Admin is its contact. The PDF is
 * generated from the project as it is now, stored privately and is the only attachment: scripts, idea files and
 * films never leave the platform by email (MF-1, 08/11/2026).
 */
@Injectable()
export class BriefService {
  private readonly logger = new Logger(BriefService.name);
  private readonly fontPath: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fontPath = unicodeFontPath(config.briefFontPath);
    if (!this.fontPath) this.logger.warn('No font with Vietnamese glyphs found; briefs drop diacritics');
  }

  /** `seasonId` limits the brief to one season; null briefs every episode of the project. */
  async prepare(
    projectId: string,
    studio: BriefStudio,
    seasonId: string | null,
    context: BriefContext,
  ): Promise<PreparedBrief> {
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: context.senderId },
      select: { fullName: true, email: true },
    });
    const project = await this.prisma.movieProject.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        movie: {
          include: {
            genres: { include: { genre: { select: { name: true } } } },
            episodes: {
              where: seasonId ? { seasonId } : {},
              orderBy: { episodeNumber: 'asc' },
              include: { season: { select: { seasonNumber: true } } },
            },
          },
        },
      },
    });
    const { movie } = project;

    const content: BriefContent = {
      movieTitle: movie.title,
      scope: seasonId ? `Mùa ${movie.episodes[0]?.season.seasonNumber ?? ''}` : 'Toàn bộ dự án',
      studioName: studio.name,
      studioContact: studio.contactName,
      contactName: sender.fullName,
      contactEmail: sender.email,
      ideaDescription: project.ideaDescription,
      genres: movie.genres.map(({ genre }) => genre.name),
      offeredFeeVnd: context.offeredFeeVnd,
      episodes: movie.episodes.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        seasonNumber: episode.season.seasonNumber,
        title: episode.title,
        targetDurationSeconds: episode.targetDurationSeconds,
        dueDate: episode.deliveryDeadline,
      })),
      issuedAt: new Date(),
    };

    const briefKey = `movies/${projectId}/briefs/${randomUUID()}.pdf`;
    await this.storage.putBuffer(briefKey, await renderBriefPdf(content, this.fontPath), 'application/pdf', 'private');

    return {
      briefKey,
      offeredFeeVnd: context.offeredFeeVnd,
      subject: `[AI Cinema] Đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope})`,
      lines: [
        `AI Cinema gửi đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope}) gồm ${movie.episodes.length} tập.`,
        `Phí sản xuất đề xuất: ${formatVnd(context.offeredFeeVnd)} (trọn gói, không chia doanh thu).`,
        'Chi tiết từng tập và hạn giao nằm trong brief PDF đính kèm.',
        'Kịch bản và việc nộp phim được thực hiện trên Studio Web sau khi hai bên thống nhất hợp đồng.',
      ],
      attachments: [{ key: briefKey, fileName: `brief-${projectId}.pdf`, contentType: 'application/pdf' }],
    };
  }
}
