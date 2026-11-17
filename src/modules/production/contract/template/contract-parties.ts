import { BLANK, type ContractParty } from './contract-clauses';

/** Bên A of every production contract. The figures are the demo company of the capstone, not a real firm. */
export const PLATFORM_PARTY: ContractParty = {
  name: 'Công ty TNHH Nền tảng Phim AI Cinema (giả lập)',
  address: 'Lô E2a-7, Đường D1, Khu Công nghệ cao, TP. Thủ Đức, TP. Hồ Chí Minh',
  taxCode: '0000000001 (giả lập)',
  phone: '028 0000 0001',
  email: 'admin@aicinema.com',
  bankAccount: '0000 0000 0001 - Ngân hàng giả lập, chi nhánh TP. Hồ Chí Minh',
  representative: 'Nguyễn Văn An',
  title: 'Giám đốc',
};

export const CONTRACT_PLACE = 'Thành phố Hồ Chí Minh';

interface StudioRow {
  name: string;
  email: string;
  phone: string | null;
  contactName: string | null;
}

/** Bên B from the studio catalogue; what the platform does not keep is left blank for the studio to fill in. */
export function studioParty(studio: StudioRow): ContractParty {
  return {
    name: studio.name,
    address: BLANK,
    taxCode: BLANK,
    phone: studio.phone ?? BLANK,
    email: studio.email,
    bankAccount: BLANK,
    representative: studio.contactName ?? BLANK,
    title: BLANK,
  };
}
