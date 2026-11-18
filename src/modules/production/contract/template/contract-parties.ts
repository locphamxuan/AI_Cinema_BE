import type { PlatformSetting, Studio } from '@prisma/client';
import { BLANK, type ContractParty } from './contract-clauses';

const orBlank = (value: string | null | undefined) => value?.trim() || BLANK;

export type PlatformPartySource = Pick<
  PlatformSetting,
  | 'contractCompanyName'
  | 'contractAddress'
  | 'contractTaxCode'
  | 'contractPhone'
  | 'contractEmail'
  | 'contractBankAccount'
  | 'contractRepresentative'
  | 'contractRepresentativeTitle'
>;

export type StudioPartySource = Pick<
  Studio,
  'name' | 'email' | 'phone' | 'contactName' | 'address' | 'taxCode' | 'bankAccount' | 'representativeTitle'
>;

/** Bên A as the Admin keeps it in the platform settings; what is not filled in prints as a blank. */
export function platformParty(settings: PlatformPartySource): ContractParty {
  return {
    name: orBlank(settings.contractCompanyName),
    address: orBlank(settings.contractAddress),
    taxCode: orBlank(settings.contractTaxCode),
    phone: orBlank(settings.contractPhone),
    email: orBlank(settings.contractEmail),
    bankAccount: orBlank(settings.contractBankAccount),
    representative: orBlank(settings.contractRepresentative),
    title: orBlank(settings.contractRepresentativeTitle),
  };
}

/** Bên B from the studio catalogue: its legal profile and the representative (contactName) who signs. */
export function studioParty(studio: StudioPartySource): ContractParty {
  return {
    name: studio.name,
    address: orBlank(studio.address),
    taxCode: orBlank(studio.taxCode),
    phone: orBlank(studio.phone),
    email: studio.email,
    bankAccount: orBlank(studio.bankAccount),
    representative: orBlank(studio.contactName),
    title: orBlank(studio.representativeTitle),
  };
}
