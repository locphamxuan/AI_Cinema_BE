import { deflateSync } from 'node:zlib';
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
  bankName: null,
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A genuine greyscale PNG of the given size, standing in for a signature image in tests. */
export function pngImage(width = 300, height = 100): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0xff)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
