import { ConflictException } from '@nestjs/common';
import type { Studio } from '@prisma/client';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';

/** The legal profile (Bên B of the contract) the studio fills in itself on Studio Web. */
export const LEGAL_PROFILE_FIELDS = ['address', 'taxCode', 'bankAccount', 'bankName', 'representativeTitle'] as const;

/** Every field the contract prints for Bên B that is still empty: the studio's own, and the Admin's contactName. */
export type LegalProfileField = (typeof LEGAL_PROFILE_FIELDS)[number] | 'contactName';

export type LegalProfileSource = Pick<Studio, 'contactName' | (typeof LEGAL_PROFILE_FIELDS)[number]>;

export const LEGAL_PROFILE_SELECT = {
  contactName: true,
  address: true,
  taxCode: true,
  bankAccount: true,
  bankName: true,
  representativeTitle: true,
} as const;

export function missingLegalFields(studio: LegalProfileSource): LegalProfileField[] {
  const fields: LegalProfileField[] = [...LEGAL_PROFILE_FIELDS, 'contactName'];
  return fields.filter((field) => !studio[field]?.trim());
}

/**
 * MF-1 (22/11/2026): a contract is only signed once Bên B is complete, so no signed copy ever prints a blank for
 * the studio. 409 STUDIO_PROFILE_INCOMPLETE names what is missing; Studio Web links to its legal profile page.
 */
export async function assertLegalProfileComplete(db: PrismaTx, studioId: string): Promise<void> {
  const studio = await db.studio.findUniqueOrThrow({ where: { id: studioId }, select: LEGAL_PROFILE_SELECT });
  const missing = missingLegalFields(studio);
  if (!missing.length) return;
  throw new ConflictException({
    message: `The studio legal profile is incomplete (${missing.join(', ')}); complete it before signing the contract`,
    details: { reason: 'STUDIO_PROFILE_INCOMPLETE', studioId, missing },
  });
}
