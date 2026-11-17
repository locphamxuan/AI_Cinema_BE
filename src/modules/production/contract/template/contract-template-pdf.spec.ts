import { PDFDocument } from 'pdf-lib';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import type { ContractDraft } from './contract-clauses';
import { PLATFORM_PARTY, studioParty } from './contract-parties';
import { renderContractPdf } from './contract-template-pdf';

const DRAFT: ContractDraft = {
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
  costVnd: null,
  budgetVnd: 200_000_000,
  partyA: PLATFORM_PARTY,
  partyB: studioParty({ name: 'Lumen', email: 'studio@lumen.example', phone: null, contactName: null }),
};

const pages = async (pdf: Buffer) => (await PDFDocument.load(pdf)).getPageCount();

describe('contract template PDF', () => {
  it('renders the unsigned template with its annex as a valid PDF', async () => {
    const pdf = await renderContractPdf(DRAFT, { fontPath: null, footnote: 'Ghi chú' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await pages(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('moves the signature boxes to a new page when the articles end low on the page', async () => {
    // Each extra genre word adds a line to article 1, so the boxes land at every height of the last page.
    const lengths = Array.from({ length: 40 }, (_, i) => i);
    const counts = await Promise.all(
      lengths.map(async (n) =>
        pages(await renderContractPdf({ ...DRAFT, genre: 'Tâm lý '.repeat(n * 25) }, { fontPath: null, footnote: '' })),
      ),
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('lets the caller draw the mark of one side inside the box of that side', async () => {
    const draw = jest.fn<void, [unknown, { x: number; partyName: string }, unknown]>();
    const draft = { ...DRAFT, costVnd: 170_000_000 };
    await renderContractPdf(draft, { fontPath: unicodeFontPath(null), footnote: 'x', mark: { side: 'STUDIO', draw } });
    await renderContractPdf(draft, { fontPath: null, footnote: 'x', mark: { side: 'ADMIN', draw } });
    const box = (call: number) => draw.mock.calls[call][1];
    expect(box(0)).toMatchObject({ x: 320, partyName: 'Lumen' });
    expect(box(1)).toMatchObject({ x: 56, partyName: PLATFORM_PARTY.name });
  });
});
