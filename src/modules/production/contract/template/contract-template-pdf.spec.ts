import { PDFDocument } from 'pdf-lib';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { DRAFT, pngImage } from './template.fixtures';
import { contractKeywords, renderContractPdf, vnDay, type SignatureStamp } from './contract-template-pdf';

const load = (pdf: Buffer) => PDFDocument.load(pdf, { updateMetadata: false });

describe('contract template PDF', () => {
  it('renders the unsigned contract with its annex and names its project in the keywords', async () => {
    const pdf = await renderContractPdf(DRAFT, {
      fontPath: null,
      footnote: 'Ghi chú',
      keywords: contractKeywords('p1', 'c1'),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getKeywords()).toBe('aicinema-project:p1 aicinema-contract:c1');
  });

  it('moves the signature boxes to a new page when the articles end low on the page', async () => {
    // Each extra genre word adds a line to article 1, so the boxes land at every height of the last page.
    const counts = await Promise.all(
      Array.from({ length: 40 }, async (_, n) => {
        const pdf = await renderContractPdf(
          { ...DRAFT, genre: 'Tâm lý '.repeat(n * 25) },
          { fontPath: null, footnote: '' },
        );
        return (await load(pdf)).getPageCount();
      }),
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('renders a signed copy on exactly the pages of the unsigned one, with each signature in its block', async () => {
    const stamp = (side: SignatureStamp['side']): SignatureStamp => ({
      side,
      image: pngImage(),
      signerName: side === 'ADMIN' ? 'Nguyễn Văn An' : 'Nguyễn Thị Lan',
      signerTitle: 'Giám đốc',
      signedAt: new Date('2026-11-21T18:30:00Z'),
    });
    const options = { fontPath: unicodeFontPath(null), footnote: 'x', keywords: contractKeywords('p1', 'c1') };
    const unsigned = await load(await renderContractPdf(DRAFT, options));
    const studio = await load(await renderContractPdf(DRAFT, { ...options, stamps: [stamp('STUDIO')] }));
    const both = await load(await renderContractPdf(DRAFT, { ...options, stamps: [stamp('STUDIO'), stamp('ADMIN')] }));

    expect(studio.getPageCount()).toBe(unsigned.getPageCount());
    expect(both.getPageCount()).toBe(unsigned.getPageCount());
    expect(both.getKeywords()).toBe(unsigned.getKeywords());
    // 18:30 UTC is already the next day in Vietnam.
    expect(vnDay(new Date('2026-11-21T18:30:00Z'))).toBe('22/11/2026');
  });
});
