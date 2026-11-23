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
  | 'name'
  | 'email'
  | 'phone'
  | 'contactName'
  | 'address'
  | 'taxCode'
  | 'bankAccount'
  | 'bankName'
  | 'representativeTitle'
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

/** "0123456789 tại Ngân hàng X", or just the number when the bank is not named. */
function studioBank({ bankAccount, bankName }: Pick<StudioPartySource, 'bankAccount' | 'bankName'>): string {
  const account = bankAccount?.trim();
  if (!account) return BLANK;
  const bank = bankName?.trim();
  return bank ? `${account} tại ${bank}` : account;
}

/**
 * Bên B from the legal profile the studio keeps on Studio Web and the representative (contactName) the Admin
 * records; read when the contract is rendered, so a copy is never filled with an older profile.
 */
export function studioParty(studio: StudioPartySource): ContractParty {
  return {
    name: studio.name,
    address: orBlank(studio.address),
    taxCode: orBlank(studio.taxCode),
    phone: orBlank(studio.phone),
    email: studio.email,
    bankAccount: studioBank(studio),
    representative: orBlank(studio.contactName),
    title: orBlank(studio.representativeTitle),
  };
}
