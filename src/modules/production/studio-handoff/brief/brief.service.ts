import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';
import type { EmailAttachment } from 'src/modules/platform/email/email-outbox.service';
import type { StoredMaterial } from '../material/handoff-material.service';
import { briefFont, type BriefContent, formatVnd, renderBriefPdf } from './brief-pdf';

export interface BriefStudio {
  name: string;
  contactName: string | null;
}

/** Who the brief comes from and the fee it offers. */
export interface BriefContext {
  /** The Admin changing the studio: named as the studio's contact and where its reply goes. */
  senderId: string;
  /** Production fee (VND) offered to the studio, already checked against the budget left. */
  offeredFeeVnd: number;
}

export interface PreparedBrief {
  briefKey: string;
  offeredFeeVnd: number;
  subject: string;
  text: string;
  attachments: EmailAttachment[];
  /** The Admin the brief comes from: shown as the sender, and where the studio's reply goes. */
  creatorName: string;
  creatorEmail: string;
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
    this.fontPath = briefFont(config.briefFontPath);
    if (!this.fontPath) this.logger.warn('No font with Vietnamese glyphs found; briefs drop diacritics');
  }

  /** `seasonId` limits the brief to one season; null briefs every episode of the project. */
  async prepare(
    projectId: string,
    studio: BriefStudio,
    seasonId: string | null,
    materials: StoredMaterial[],
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
        ideaFiles: { where: { purpose: 'IDEA' }, orderBy: [{ fileName: 'asc' }, { version: 'desc' }] },
      },
    });
    const { movie } = project;
    const latestIdeaFiles = project.ideaFiles.filter(
      (file, i, all) => all.findIndex((other) => other.fileName === file.fileName) === i,
    );

    const content: BriefContent = {
      movieTitle: movie.title,
      scope: seasonId ? `Mùa ${movie.episodes[0]?.season.seasonNumber ?? ''}` : 'Toàn bộ dự án',
      studioName: studio.name,
      studioContact: studio.contactName,
      creatorName: sender.fullName,
      creatorEmail: sender.email,
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
      ideaFiles: [...latestIdeaFiles.map((file) => file.fileName), ...materials.map((file) => file.fileName)],
      issuedAt: new Date(),
    };

    const briefKey = `movies/${projectId}/briefs/${randomUUID()}.pdf`;
    await this.storage.putBuffer(briefKey, await renderBriefPdf(content, this.fontPath), 'application/pdf', 'private');

    return {
      briefKey,
      offeredFeeVnd: context.offeredFeeVnd,
      creatorName: content.creatorName,
      creatorEmail: content.creatorEmail,
      subject: `[AI Cinema] Đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope})`,
      text: [
        `Kính gửi ${studio.name},`,
        '',
        `AI Cinema gửi đơn đặt hàng sản xuất phim "${movie.title}" (${content.scope}) gồm ${movie.episodes.length} tập.`,
        `Phí sản xuất đề xuất: ${formatVnd(context.offeredFeeVnd)} (trọn gói, không chia doanh thu).`,
        'Nếu chưa đồng ý mức phí, vui lòng trả lời thư này cho đầu mối bên dưới.',
        'Chi tiết từng tập và hạn giao nằm trong brief PDF đính kèm.',
        'Kịch bản và việc nộp phim được thực hiện trên hệ thống sau khi hai bên thống nhất hợp đồng.',
        '',
        `Đầu mối: ${content.creatorName} - ${content.creatorEmail}`,
      ].join('\n'),
      attachments: [{ key: briefKey, fileName: `brief-${projectId}.pdf`, contentType: 'application/pdf' }],
    };
  }
}
