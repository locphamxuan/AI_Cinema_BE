import type { ContractDraft } from './contract-clauses';
import { platformParty, studioParty, type PlatformPartySource, type StudioPartySource } from './contract-parties';

/** Test data shared by the contract template specs. */
export const PLATFORM: PlatformPartySource = {
  contractCompanyName: 'Công ty TNHH AI Cinema',
  contractAddress: 'Thủ Đức',
  contractTaxCode: '0001',
  contractPhone: '028 1',
  contractEmail: 'legal@aicinema.vn',
  contractBankAccount: '0001 - VCB',
  contractRepresentative: 'Nguyễn Văn An',
  contractRepresentativeTitle: 'Giám đốc',
};

export const STUDIO: StudioPartySource = {
  name: 'Lumen Studio',
  email: 'studio@lumen.example',
  phone: null,
  contactName: 'Nguyễn Thị Lan',
  address: null,
  taxCode: '0002',
  bankAccount: null,
  representativeTitle: null,
};

export const DRAFT: ContractDraft = {
  contractNo: 'AIC-1',
  day: '17 tháng 11 năm 2026',
  place: 'Thành phố Hồ Chí Minh',
  movieTitle: 'Giấc Mơ Số',
  genre: 'Tâm lý',
  ageRating: 'T13',
  episodes: [
    { number: 1, title: 'Khởi động', minutes: 12, dueDate: '25/11/2026' },
    { number: 2, title: 'Dữ liệu lạc', minutes: 12, dueDate: '-' },
  ],
  costVnd: 200_000_000,
  budgetVnd: 200_000_000,
  partyA: platformParty(PLATFORM),
  partyB: studioParty(STUDIO),
};
