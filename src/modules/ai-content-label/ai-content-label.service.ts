import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAiContentLabelRequestDto } from './dto/create-ai-content-label.request.dto';

@Injectable()
export class AiContentLabelService {
  constructor(private readonly prisma: PrismaService) {}

  async create(packageId: string, dto: CreateAiContentLabelRequestDto) {
    await this.requirePackage(packageId);

    const policy = await this.prisma.policy.findUnique({ where: { id: dto.policyId } });
    if (!policy) throw new BadRequestException(`Policy with id "${dto.policyId}" does not exist`);

    // let appliedById: string | undefined;
    // if (dto.appliedById) {
    //   const user = await this.prisma.user.findUnique({ where: { id: dto.appliedById } });
    //   if (!user) throw new BadRequestException(`User with id "${dto.appliedById}" does not exist`);
    //   appliedById = user.id;
    // }

    return this.prisma.aiContentLabel.create({
      data: {
        episodePackageId: packageId,
        labelType: dto.labelType,
        labelText: dto.labelText,
        displayLocation: dto.displayLocation,
        appliedById: '986e766b-4fc0-4764-aeb5-8232ea09e8b9',
        policyId: policy.id,
      },
      include: { policy: true, appliedBy: { select: { fullName: true } } },
    });
  }

  async findAll(packageId: string) {
    await this.requirePackage(packageId);
    return this.prisma.aiContentLabel.findMany({
      where: { episodePackageId: packageId },
      orderBy: { id: 'asc' },
      include: { policy: true, appliedBy: { select: { fullName: true } } },
    });
  }

  private async requirePackage(packageId: string) {
    const pkg = await this.prisma.episodePackage.findUnique({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException(`Episode package with id "${packageId}" does not exist`);
    return pkg;
  }
}
