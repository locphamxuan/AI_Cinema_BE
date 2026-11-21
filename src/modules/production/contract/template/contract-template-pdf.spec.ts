import { PDFDocument } from 'pdf-lib';
import { unicodeFontPath } from 'src/infrastructure/pdf/unicode-font';
import { DRAFT } from './template.fixtures';
import { contractKeywords, renderContractPdf, type SignatureMark } from './contract-template-pdf';
import { demoMark, sealName } from './demo-signature';

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

  it('draws each mark in the box of its side', async () => {
    const draw = jest.fn<void, Parameters<SignatureMark['draw']>>();
    await renderContractPdf(DRAFT, {
      fontPath: unicodeFontPath(null),
      footnote: 'x',
      marks: [
        { side: 'STUDIO', draw },
        { side: 'ADMIN', draw },
      ],
    });
    expect(draw.mock.calls.map(([, box]) => [box.x, box.partyName])).toEqual([
      [320, 'Lumen Studio'],
      [56, 'Công ty TNHH AI Cinema'],
    ]);
  });

  it('draws the demo signature and seal, the seal naming the short trade name', async () => {
    const pdf = await renderContractPdf(DRAFT, {
      fontPath: null,
      footnote: '',
      marks: [demoMark('STUDIO'), demoMark('ADMIN')],
    });
    expect((await load(pdf)).getPageCount()).toBeGreaterThanOrEqual(2);
    expect(sealName('Công ty TNHH Lumen Studio (giả lập)')).toBe('LUMEN STUDIO');
    expect(sealName('Công ty Cổ phần Phim Việt')).toBe('PHIM VIỆT');
  });
});
