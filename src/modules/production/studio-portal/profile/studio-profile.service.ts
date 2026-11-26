import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { StudioAccountService } from 'src/modules/production/studio/studio-account.service';
import { missingLegalFields } from 'src/modules/production/studio/studio-legal-profile';
import type { UpdateStudioLegalProfileRequestDto } from './dto/studio-legal-profile.request.dto';

const PROFILE = {
  id: true,
  name: true,
  email: true,
  contactName: true,
  phone: true,
  address: true,
  taxCode: true,
  bankAccount: true,
  bankName: true,
  representativeTitle: true,
} as const;

/**
 * The studio's own legal profile (MF-1, 22/11/2026): it fills in Bên B of its contracts itself, so the Admin never
 * types a partner's tax or bank data. `missing` lists what still blocks signing (contactName is the Admin's).
 */
@Injectable()
export class StudioProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: StudioAccountService,
  ) {}

  async get(user: AuthenticatedUser) {
    const studioId = await this.accounts.studioOf(user);
    return this.view(await this.prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: PROFILE }));
  }

  async update(user: AuthenticatedUser, dto: UpdateStudioLegalProfileRequestDto) {
    const studioId = await this.accounts.studioOf(user);
    const { address, taxCode, bankAccount, bankName, representativeTitle } = dto;
    const studio = await this.prisma.studio.update({
      where: { id: studioId },
      data: { address, taxCode, bankAccount, bankName, representativeTitle },
      select: PROFILE,
    });
    return this.view(studio);
  }

  private view<T extends Parameters<typeof missingLegalFields>[0]>(studio: T) {
    const missing = missingLegalFields(studio);
    return { ...studio, missing, complete: missing.length === 0 };
  }
}
