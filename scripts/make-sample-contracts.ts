import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mergeSignedCounterparts } from '../src/modules/production/contract/contract-pdf';
import { unicodeFontPath } from '../src/infrastructure/pdf/unicode-font';
import { renderSampleContract, type SampleContract } from './sample-contract-pdf';

/**
 * Demo props for MF-1: the two signed counterparts an Admin and a studio would upload, plus the document the
 * system merges out of them. Run with `npm run contracts:samples [outputDir]`; nothing here touches the
 * database or the real storage driver.
 */
const SAMPLE: SampleContract = {
  contractNo: 'AIC-2026-001',
  day: '10/11/2026',
  movieTitle: 'Giấc Mơ Số',
  episodes: 6,
  costVnd: 170_000_000,
  costInWords: 'một trăm bảy mươi triệu đồng',
  studioName: 'Lumen Studio',
  studioSigner: 'Trần Thị B — Giám đốc Lumen Studio',
  adminSigner: 'Nguyễn Văn A — Quản trị viên AI Cinema',
};

const SIGNED_AT = new Date('2026-11-10T03:00:00.000Z');

async function main(): Promise<void> {
  const outputDir = resolve(process.argv[2] ?? join(__dirname, '..', 'storage', 'sample-contracts'));
  await mkdir(outputDir, { recursive: true });

  const admin = await renderSampleContract(SAMPLE, 'ADMIN');
  const studio = await renderSampleContract(SAMPLE, 'STUDIO');
  const merged = await mergeSignedCounterparts(
    { admin, studio },
    {
      contractId: SAMPLE.contractNo,
      round: 1,
      movieTitle: SAMPLE.movieTitle,
      studioName: SAMPLE.studioName,
      costVnd: SAMPLE.costVnd,
      adminName: SAMPLE.adminSigner,
      adminSignedAt: SIGNED_AT,
      studioSignedAt: SIGNED_AT,
    },
    unicodeFontPath(null),
  );

  const files: [string, Buffer][] = [
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
