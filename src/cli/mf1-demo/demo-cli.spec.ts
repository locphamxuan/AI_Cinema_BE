import type { PrismaClient } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { contractKeywords } from 'src/modules/production/contract/template/contract-template-pdf';
import { asUpload, inDays, loadDemoData, pickFilm } from './demo-data';
import { deliverFromR2 } from './deliver-from-r2';
import { contractIdOf, marksFor, signDemoContract, SIGN_DEMO_USAGE } from './demo-signer';

async function pdfNamed(keywords?: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  if (keywords) doc.setKeywords([keywords]);
  return Buffer.from(await doc.save());
}

describe('MF-1 demo CLI', () => {
  it('reads which round a downloaded contract PDF belongs to', async () => {
    await expect(contractIdOf(await pdfNamed(contractKeywords('p1', 'c-42')))).resolves.toBe('c-42');
    await expect(contractIdOf(await pdfNamed())).rejects.toThrow(/not downloaded from AI Cinema/);
  });

  it('signs as the studio, or as the Admin on the copy the studio already signed', () => {
    expect(marksFor('studio')).toEqual(['STUDIO']);
    expect(marksFor('admin')).toEqual(['STUDIO', 'ADMIN']);
    expect(() => marksFor('reviewer')).toThrow(/studio" or "admin/);
  });

  it('takes every demo value from the data file and a catalogue film with enough episodes', () => {
    const { data, film } = loadDemoData();
    expect(data.platformParty.contractCompanyName).toBeTruthy();
    expect(data.studioProfile.taxCode).toBeTruthy();
    expect(data.project.budgetVnd).toBeGreaterThan(0);
    expect(data.stages.length).toBeGreaterThanOrEqual(5);
    expect(film.episodes.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a catalogue without a film long enough for the demo', () => {
    const film = { title: 'A', genres: [], synopsis: '', episodes: [] };
    expect(() => pickFilm([film], 3)).toThrow(/no film with 3 episodes/);
  });

  it('writes the downloaded contract again with the demo signature of the side', async () => {
    const signedCopy = jest
      .fn<Promise<Buffer>, [string, { side: string }[]]>()
      .mockResolvedValue(Buffer.from('%PDF-signed'));
    const app = { get: () => ({ signedCopy }) } as never;
    const files = {
      read: jest.fn().mockResolvedValue(await pdfNamed(contractKeywords('p1', 'c-7'))),
      write: jest.fn(),
    };

    await expect(signDemoContract(app, ['hop-dong.PDF', 'studio'], files)).resolves.toBe('hop-dong-da-ky-studio.pdf');
    await expect(signDemoContract(app, ['a.pdf', 'admin', 'out.pdf'], files)).resolves.toBe('out.pdf');

    expect(signedCopy.mock.calls.map(([id, marks]) => [id, marks.map((m) => m.side)])).toEqual([
      ['c-7', ['STUDIO']],
      ['c-7', ['STUDIO', 'ADMIN']],
    ]);
    expect(files.write).toHaveBeenCalledWith('out.pdf', Buffer.from('%PDF-signed'));
    await expect(signDemoContract(app, ['a.pdf'], files)).rejects.toThrow(SIGN_DEMO_USAGE);
  });

  it('builds dates and uploads the way the services expect them', () => {
    expect(inDays(0)).toBe(new Date().toISOString().slice(0, 10));
    expect(asUpload(Buffer.from('%PDF'), 'a.pdf')).toMatchObject({
      originalname: 'a.pdf',
      size: 4,
      mimetype: 'application/pdf',
    });
  });

  it('delivers an episode as its R2 file, ready for review', async () => {
    const prisma = {
      mediaAsset: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      episode: { update: jest.fn() },
    };
    const source = { number: 1, title: 'T1', url: 'https://r2/x.mp4', size: 10, duration: 61.4 };
    const delivery = { episodeId: 'e1', studioUserId: 'u1', source, note: 'giao' };

    await expect(deliverFromR2(prisma as unknown as PrismaClient, delivery)).resolves.toBe('m1');
    await deliverFromR2(prisma as unknown as PrismaClient, { ...delivery, source: { ...source, height: 1080 } });

    const [plain, sized] = prisma.mediaAsset.create.mock.calls.map(
      ([arg]) => (arg as { data: Record<string, unknown> }).data,
    );
    expect(plain).toMatchObject({ episodeId: 'e1', durationSeconds: 61, qualities: [], submissionNote: 'giao' });
    expect(sized.qualities).toEqual(['1080p']);
    expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'IN_REVIEW' } });
  });
});
