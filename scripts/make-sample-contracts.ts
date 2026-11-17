import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mergeSignedCounterparts } from '../src/modules/production/contract/contract-pdf';
import { unicodeFontPath } from '../src/infrastructure/pdf/unicode-font';
import type { ContractDraft } from '../src/modules/production/contract/template/contract-clauses';
import { PLATFORM_PARTY } from '../src/modules/production/contract/template/contract-parties';
import { renderSampleContract } from './sample-contract-pdf';

/**
 * Demo props for MF-1: the unsigned template the studio receives, the two signed counterparts an Admin and a studio would upload, plus the document the
 * system merges out of them. Run with `npm run contracts:samples [outputDir]`; nothing here touches the
 * database or the real storage driver.
 */
const SAMPLE: ContractDraft = {
  contractNo: 'AIC-2026-001',
  day: '10 tháng 11 năm 2026',
  place: 'Thành phố Hồ Chí Minh',
  movieTitle: 'Giấc Mơ Số',
  genre: 'Khoa học viễn tưởng - Tâm lý',
  ageRating: 'T13',
  episodes: [
    { number: 1, title: 'Khởi động', minutes: 12, dueDate: '25/11/2026' },
    { number: 2, title: 'Dữ liệu lạc', minutes: 12, dueDate: '02/12/2026' },
    { number: 3, title: 'Thành phố ảo', minutes: 13, dueDate: '09/12/2026' },
    { number: 4, title: 'Ký ức thứ hai', minutes: 12, dueDate: '16/12/2026' },
    { number: 5, title: 'Lỗi hệ thống', minutes: 13, dueDate: '23/12/2026' },
    { number: 6, title: 'Thức giấc', minutes: 15, dueDate: '30/12/2026' },
  ],
  costVnd: 170_000_000,
  costInWords: 'Một trăm bảy mươi triệu đồng',
  budgetVnd: 200_000_000,
  partyA: PLATFORM_PARTY,
  partyB: {
    name: 'Công ty TNHH Lumen Studio (giả lập)',
    address: '00 Đường Số 1, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    taxCode: '0000000002 (giả lập)',
    phone: '028 0000 0002',
    email: 'studio@lumen.example',
    bankAccount: '0000 0000 0002 - Ngân hàng giả lập, chi nhánh Quận 1',
    representative: 'Trần Thị Bình',
    title: 'Giám đốc',
  },
};

const SIGNED_AT = new Date('2026-11-10T03:00:00.000Z');

async function main(): Promise<void> {
  const outputDir = resolve(process.argv[2] ?? join(__dirname, '..', 'storage', 'sample-contracts'));
  await mkdir(outputDir, { recursive: true });

  const template = await renderSampleContract({ ...SAMPLE, costVnd: null }, null);
  const admin = await renderSampleContract(SAMPLE, 'ADMIN');
  const studio = await renderSampleContract(SAMPLE, 'STUDIO');
  const merged = await mergeSignedCounterparts(
    { admin, studio },
    {
      contractId: SAMPLE.contractNo,
      round: 1,
      movieTitle: SAMPLE.movieTitle,
      studioName: SAMPLE.partyB.name,
      costVnd: 170_000_000,
      adminName: SAMPLE.partyA.representative,
      adminSignedAt: SIGNED_AT,
      studioSignedAt: SIGNED_AT,
    },
    unicodeFontPath(null),
  );

  const files: [string, Buffer][] = [
    ['hop-dong-ai-cinema-mau-chua-ky.pdf', template],
    ['hop-dong-ai-cinema-ban-ky-admin.pdf', admin],
    ['hop-dong-ai-cinema-ban-ky-studio.pdf', studio],
    ['hop-dong-ai-cinema-du-hai-chu-ky.pdf', merged],
  ];
  for (const [name, body] of files) {
    const path = join(outputDir, name);
    await writeFile(path, body);
    console.log(`${path} (${body.length} bytes)`);
  }
}

void main();
