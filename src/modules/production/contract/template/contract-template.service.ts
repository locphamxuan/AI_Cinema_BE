import { Inject, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ContractHandoffService } from '../contract-handoff.service';
import type { ContractDraft } from './contract-clauses';
import { CONTRACT_PLACE, PLATFORM_PARTY, studioParty } from './contract-parties';
import { renderContractPdf } from './contract-template-pdf';

const TEMPLATE_SOURCE = {
  id: true,
  round: true,
  projectId: true,
  handoffId: true,
  costVnd: true,
  status: true,
  createdAt: true,
  studio: { select: { name: true, email: true, phone: true, contactName: true } },
  project: {
    select: {
      movie: {
        select: {
          title: true,
          ageRating: true,
          genres: { select: { genre: { select: { name: true } } } },
          episodes: {
            orderBy: { episodeNumber: 'asc' },
            select: { episodeNumber: true, title: true, targetDurationSeconds: true, deliveryDeadline: true },
          },
        },
      },
    },
  },
} as const;

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const FOOTNOTE = 'Bản hợp đồng mẫu do Hệ thống AI Cinema tạo; mỗi bên ký, đóng dấu rồi tải bản PDF đã ký lên hệ thống.';

/** dd/mm/yyyy in Vietnam time. */
export const vnDay = (date: Date) => VN_DATE.format(date);

/** "ngày 17 tháng 11 năm 2026" as a contract preamble writes it. */
export function longVnDay(date: Date): string {
  const [day, month, year] = vnDay(date).split('/');
  return `${day} tháng ${month} năm ${year}`;
}

/**
 * The unsigned contract the studio checks before quoting (MF-1 §3): the 14 template articles filled with the
 * project, the studio and the budget ceiling. Generated on every download, so it always shows the budget as it
 * is now; nothing is stored until a side uploads its signed copy.
 */
@Injectable()
export class ContractTemplateService {
  private readonly fontPath: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly handoffs: ContractHandoffService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fontPath = unicodeFontPath(config.briefFontPath);
  }

  /** The Admin and the Reviewer of the project download the template a round was sent with. */
  async forStaff(contractId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, select: TEMPLATE_SOURCE });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.access.project(contract.projectId, user, 'read');
    return this.file(contract);
  }

  /** The studio of the round downloads it; another studio gets a 404. */
  async forStudio(contractId: string, studioId: string): Promise<StreamableFile> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, studioId },
      select: TEMPLATE_SOURCE,
    });
    if (!contract) throw new NotFoundException('Contract not found');
    return this.file(contract);
  }

  private async file(contract: Source): Promise<StreamableFile> {
    const draft = await this.draft(contract);
    const pdf = await renderContractPdf(draft, { fontPath: this.fontPath, footnote: FOOTNOTE });
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="hop-dong-mau-${draft.contractNo}.pdf"`,
      length: pdf.length,
    });
  }

  private async draft(contract: Source): Promise<ContractDraft> {
    const { movie } = contract.project;
    return {
      contractNo: `AIC-${contract.createdAt.getUTCFullYear()}-${contract.id.slice(0, 8).toUpperCase()}-R${contract.round}`,
      day: longVnDay(contract.createdAt),
      place: CONTRACT_PLACE,
      movieTitle: movie.title,
      genre: movie.genres.map(({ genre }) => genre.name).join(', ') || 'chưa phân loại',
      ageRating: movie.ageRating ?? 'chưa phân loại',
      episodes: movie.episodes.map((e) => ({
        number: e.episodeNumber,
        title: e.title,
        minutes: Math.round(e.targetDurationSeconds / 60),
        dueDate: e.deliveryDeadline ? vnDay(e.deliveryDeadline) : '-',
      })),
      costVnd: contract.costVnd === null ? null : Number(contract.costVnd),
      budgetVnd: await this.handoffs.budgetOf(this.prisma, contract),
      partyA: PLATFORM_PARTY,
      partyB: studioParty(contract.studio),
    };
  }
}

type Source = Prisma.ContractGetPayload<{ select: typeof TEMPLATE_SOURCE }>;
