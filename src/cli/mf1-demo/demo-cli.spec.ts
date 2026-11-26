import type { PrismaClient } from '@prisma/client';
import { readSignatureImage } from 'src/modules/production/contract/signature-image';
import { inDays, loadDemoData, pickFilm, signatureUpload } from './demo-data';
import { deliverFromR2 } from './deliver-from-r2';

describe('MF-1 demo CLI', () => {
  it('takes every demo value from the data file and a catalogue film with enough episodes', () => {
    const { data, film } = loadDemoData();
    expect(data.platformParty.contractCompanyName).toBeTruthy();
    expect(data.studioLegalProfile.taxCode).toMatch(/^\d{10}$/);
    expect(data.studioContact.contactName).toBeTruthy();
    expect(data.project.budgetVnd).toBeGreaterThan(0);
    expect(data.stages.length).toBeGreaterThanOrEqual(5);
    expect(film.episodes.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a catalogue without a film long enough for the demo', () => {
    const film = { title: 'A', genres: [], synopsis: '', episodes: [] };
    expect(() => pickFilm([film], 3)).toThrow(/no film with 3 episodes/);
  });

  it('builds dates, and signature uploads the signing services accept', async () => {
    expect(inDays(0)).toBe(new Date().toISOString().slice(0, 10));
    const { data } = loadDemoData();
    for (const name of [data.signatures.studio, data.signatures.admin]) {
      const upload = signatureUpload(name);
      expect(upload).toMatchObject({ originalname: name, mimetype: 'image/png' });
      await expect(readSignatureImage(upload)).resolves.toMatchObject({ mimeType: 'image/png' });
    }
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
