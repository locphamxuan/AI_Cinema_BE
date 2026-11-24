import { Inject, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { PlatformSettingService } from 'src/modules/platform/platform-setting/platform-setting.service';
import { ProjectAccessService } from 'src/modules/production/project-access/project-access.service';
import { ContractHandoffService } from '../contract-handoff.service';
import { BLANK, type ContractDraft } from './contract-clauses';
import { platformParty, studioParty } from './contract-parties';
import {
  contractKeywords,
  renderContractPdf,
  vnDay,
  type ContractSide,
  type SignatureStamp,
} from './contract-template-pdf';

const TEMPLATE_SOURCE = {
  id: true,
  round: true,
  projectId: true,
  handoffId: true,
  costVnd: true,
  ceilingVnd: true,
  status: true,
  createdAt: true,
  studio: {
    select: {
      name: true,
      email: true,
      phone: true,
      contactName: true,
      address: true,
      taxCode: true,
      bankAccount: true,
      bankName: true,
      representativeTitle: true,
    },
  },
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

type Source = Prisma.ContractGetPayload<{ select: typeof TEMPLATE_SOURCE }>;

const FOOTNOTE = 'Hợp đồng do Hệ thống AI Cinema tạo; mỗi bên ký bằng cách tải ảnh chữ ký của mình lên hệ thống.';

/** "17 tháng 11 năm 2026" as a contract preamble writes it. */
export function longVnDay(date: Date): string {
  const [day, month, year] = vnDay(date).split('/');
  return `${day} tháng ${month} năm ${year}`;
}

/**
 * The contract of a round as a PDF (MF-1 §3): the 14 articles filled with the project, Bên A from the platform
 * settings, Bên B from the studio catalogue, and priced at the budget ceiling until a side proposed another cost.
 * The unsigned contract is generated on every download from the data as it is now; the signed copies are the same
 * rendering with the uploaded signature images drawn in (signedCopy), stored when a side signs.
 */
@Injectable()
export class ContractTemplateService {
  private readonly fontPath: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly handoffs: ContractHandoffService,
    private readonly settings: PlatformSettingService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fontPath = unicodeFontPath(config.briefFontPath);
  }

  /** The Admin and the Reviewer of the project download the contract of a round. */
  async forStaff(contractId: string, user: AuthenticatedUser): Promise<StreamableFile> {
    const contract = await this.load({ id: contractId });
    await this.access.project(contract.projectId, user, 'read');
    return this.file(contract, await this.render(contract));
  }

  /** The studio of the round downloads it; another studio gets a 404. */
  async forStudio(contractId: string, studioId: string): Promise<StreamableFile> {
    const contract = await this.load({ id: contractId, studioId });
    return this.file(contract, await this.render(contract));
  }

  /** The same contract, read through the signing transaction, with the given signatures drawn in. */
  async signedCopy(client: PrismaTx, contractId: string, stamps: SignatureStamp[]): Promise<Buffer> {
    return this.render(await this.load({ id: contractId }, client), stamps, client);
  }

  /** Who signs for a side, as the contract prints it now: the representative and title of that party. */
  async signer(client: PrismaTx, contractId: string, side: ContractSide): Promise<{ name: string; title: string }> {
    const { partyA, partyB } = await this.draft(await this.load({ id: contractId }, client), client);
    const party = side === 'ADMIN' ? partyA : partyB;
    return { name: party.representative, title: party.title };
  }

  private async load(where: Prisma.ContractWhereInput, client: PrismaTx = this.prisma): Promise<Source> {
    const contract = await client.contract.findFirst({ where, select: TEMPLATE_SOURCE });
    if (!contract) throw new NotFoundException('Contract not found');
    return contract;
  }

  private async render(contract: Source, stamps: SignatureStamp[] = [], client?: PrismaTx): Promise<Buffer> {
    return renderContractPdf(await this.draft(contract, client), {
      fontPath: this.fontPath,
      footnote: FOOTNOTE,
      keywords: contractKeywords(contract.projectId, contract.id),
      stamps,
    });
  }

  private file(contract: Source, pdf: Buffer): StreamableFile {
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="hop-dong-chua-ky-${contractNo(contract)}.pdf"`,
      length: pdf.length,
    });
  }

  private async draft(contract: Source, client: PrismaTx = this.prisma): Promise<ContractDraft> {
    const { movie } = contract.project;
    const [settings, budgetVnd] = await Promise.all([this.settings.get(), this.handoffs.budgetOf(client, contract)]);
    return {
      contractNo: contractNo(contract),
      day: longVnDay(contract.createdAt),
      place: settings.contractPlace?.trim() || BLANK,
      movieTitle: movie.title,
      genre: movie.genres.map(({ genre }) => genre.name).join(', ') || 'chưa phân loại',
      ageRating: movie.ageRating ?? 'chưa phân loại',
      episodes: movie.episodes.map((e) => ({
        number: e.episodeNumber,
        title: e.title,
        minutes: Math.round(e.targetDurationSeconds / 60),
        dueDate: e.deliveryDeadline ? vnDay(e.deliveryDeadline) : '-',
      })),
      costVnd: contract.costVnd === null ? budgetVnd : Number(contract.costVnd),
      budgetVnd,
      partyA: platformParty(settings),
      partyB: studioParty(contract.studio),
    };
  }
}

/**
 * "AIC-2026-9F2B4C6E-R1": year, the start of the round id and the round. Printed on the contract and part of every
 * file name of the round, so copies of different projects never share a name in a Downloads folder.
 */
export function contractNo(contract: Pick<Source, 'id' | 'round' | 'createdAt'>): string {
  return `AIC-${contract.createdAt.getUTCFullYear()}-${contract.id.slice(0, 8).toUpperCase()}-R${contract.round}`;
}
