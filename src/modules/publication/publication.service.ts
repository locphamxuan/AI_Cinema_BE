import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplianceResult, EpisodeProductionStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { complianceVerdict } from 'src/modules/compliance-check/compliance-verdict';
import { CreatePublicationRequestDto } from './dto/create-publication.request.dto';

@Injectable()
export class PublicationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(episodeId: string, dto: CreatePublicationRequestDto, publishedById: string) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException(`Episode with id "${episodeId}" does not exist`);
    if (episode.currentPackageId !== dto.packageId) {
      throw new BadRequestException('Can only publish the current package of the episode');
    }

    const pkg = await this.prisma.episodePackage.findUnique({
      where: { id: dto.packageId },
      include: { complianceChecks: true },
    });
    if (!pkg) throw new NotFoundException(`Episode package with id "${dto.packageId}" does not exist`);
    if (complianceVerdict(pkg.complianceChecks) !== ComplianceResult.PASS) {
      throw new ConflictException('The package has not passed every compliance check (BR-42)');
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid ISO-8601 date');
    }

    return this.prisma.publication.create({
      data: {
        episodeId,
        episodePackageId: dto.packageId,
        scheduledAt,
        publishedById,
      },
      include: { episode: true, episodePackage: true },
    });
  }

  async publish(publicationId: string) {
    const publication = await this.requirePublication(publicationId);
    if (publication.publishedAt) {
      throw new ConflictException(`Publication "${publicationId}" is already published`);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.publication.update({
        where: { id: publicationId },
        data: { publishedAt: new Date() },
      });
      await tx.episode.update({
        where: { id: publication.episodeId },
        data: { productionStatus: EpisodeProductionStatus.PUBLISHED },
      });
      return updated;
    });
  }

  async unpublish(publicationId: string) {
    const publication = await this.requirePublication(publicationId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.publication.update({
        where: { id: publicationId },
        data: { unpublishedAt: new Date() },
      });
      await tx.episode.update({
        where: { id: publication.episodeId },
        data: { productionStatus: EpisodeProductionStatus.UNPUBLISHED },
      });
      return updated;
    });
  }

  async findAll(episodeId: string) {
    const episode = await this.prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException(`Episode with id "${episodeId}" does not exist`);
    return this.prisma.publication.findMany({
      where: { episodeId },
      orderBy: { id: 'asc' },
      include: { episodePackage: true, publishedBy: { select: { fullName: true } } },
    });
  }

  private async requirePublication(publicationId: string) {
    const publication = await this.prisma.publication.findUnique({ where: { id: publicationId } });
    if (!publication) throw new NotFoundException(`Publication with id "${publicationId}" does not exist`);
    return publication;
  }
}
