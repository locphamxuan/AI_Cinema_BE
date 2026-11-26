import PDFDocument from 'pdfkit';
import { pdfText } from 'src/infrastructure/pdf/unicode-font';
import { articles, LEGAL_BASES, money, type ContractDraft, type ContractParty } from './contract-clauses';

export type ContractSide = 'ADMIN' | 'STUDIO';
type Text = (value: string) => string;

/**
 * One side's signature on a signed copy (MF-1, 22/11/2026): the image it uploaded, drawn in its signature block
 * with the signer's name, title and the signing date. Without stamps the contract is the unsigned one.
 */
export interface SignatureStamp {
  side: ContractSide;
  image: Buffer;
  signerName: string;
  signerTitle: string;
  signedAt: Date;
}

const VN_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** dd/mm/yyyy in Vietnam time. */
export const vnDay = (date: Date) => VN_DATE.format(date);

const LEFT = 56;
const WIDTH = 483;
const RIGHT_BOX = 320;

/**
 * Every copy the system renders names its project and round in the PDF keywords, so a stored or downloaded copy
 * can always be traced back to the round it was issued for.
 */
export const PROJECT_MARKER = 'aicinema-project:';
export const CONTRACT_MARKER = 'aicinema-contract:';
export const contractKeywords = (projectId: string, contractId: string) =>
  `${PROJECT_MARKER}${projectId} ${CONTRACT_MARKER}${contractId}`;

function party(doc: PDFKit.PDFDocument, label: string, p: ContractParty, text: Text): void {
  doc
    .moveDown(0.5)
    .fontSize(11)
    .text(text(`${label}: ${p.name.toUpperCase()}`));
  doc.fontSize(10);
  for (const line of [
    `Địa chỉ trụ sở: ${p.address}`,
    `Mã số thuế: ${p.taxCode}`,
    `Điện thoại: ${p.phone}     Email: ${p.email}`,
    `Tài khoản: ${p.bankAccount}`,
    `Đại diện: Ông/Bà ${p.representative}     Chức vụ: ${p.title}`,
  ]) {
    doc.text(text(line), { indent: 14 });
  }
}

function annex(doc: PDFKit.PDFDocument, c: ContractDraft, text: Text): void {
  doc.addPage();
  doc.fontSize(13).text(text('PHỤ LỤC 01'), { align: 'center' });
  doc.fontSize(11).text(text(`DANH SÁCH TẬP PHIM VÀ HẠN GIAO (kèm Hợp đồng số ${c.contractNo})`), { align: 'center' });
  doc.moveDown();
  const cols = [LEFT, LEFT + 50, LEFT + 260, LEFT + 360];
  const row = (cells: string[], y: number) =>
    cells.forEach((cell, i) => doc.text(text(cell), cols[i] + 4, y + 5, { width: 200 }));
  const tableTop = doc.y;
  let y = tableTop;
  doc.fontSize(10);
  doc.rect(LEFT, y, WIDTH, 22).stroke();
  row(['Tập', 'Tên tập', 'Thời lượng', 'Hạn giao'], y);
  for (const e of c.episodes) {
    y += 22;
    doc.rect(LEFT, y, WIDTH, 22).stroke();
    row([String(e.number), e.title, `${e.minutes} phút`, e.dueDate], y);
  }
  for (const x of cols.slice(1))
    doc
      .moveTo(x, tableTop)
      .lineTo(x, y + 22)
      .stroke();
  doc.text(
    text(
      `Tổng số tập: ${c.episodes.length}. Giá trị Hợp đồng: ${money(c.costVnd)}. Ngân sách trần: ${money(c.budgetVnd)}.`,
    ),
    LEFT,
    y + 34,
    { width: WIDTH },
  );
}

function signatures(doc: PDFKit.PDFDocument, c: ContractDraft, text: Text, stamps: SignatureStamp[]): void {
  if (doc.y > 600) doc.addPage();
  const top = doc.y + 24;
  const blocks = [
    { side: 'ADMIN', x: LEFT, label: 'ĐẠI DIỆN BÊN A', party: c.partyA },
    { side: 'STUDIO', x: RIGHT_BOX, label: 'ĐẠI DIỆN BÊN B', party: c.partyB },
  ] as const;
  for (const { side, x, label, party } of blocks) {
    const stamp = stamps.find((s) => s.side === side);
    const box = { width: 220, align: 'center' } as const;
    doc.fontSize(11).text(text(label), x, top, box);
    doc
      .fontSize(9)
      .fillColor('#555555')
      .text(text('(Ký, ghi rõ họ tên, đóng dấu)'), x, top + 15, box);
    doc.fillColor('#000000');
    if (stamp) doc.image(stamp.image, x + 20, top + 32, { fit: [180, 80], align: 'center', valign: 'center' });
    doc.fontSize(11).text(text(stamp?.signerName ?? party.representative), x, top + 120, box);
    doc.fontSize(9).text(text(stamp?.signerTitle ?? party.title), x, top + 136, box);
    if (stamp) doc.text(text(`Ngày ký: ${vnDay(stamp.signedAt)}`), x, top + 150, box);
  }
}

function footers(doc: PDFKit.PDFDocument, c: ContractDraft, text: Text, note: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit open a new page: lift the margin for the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#777777');
    const line = { width: WIDTH, align: 'center', lineBreak: false } as const;
    doc.text(text(`Hợp đồng số ${c.contractNo} - Trang ${i + 1}/${range.count}`), LEFT, 800, line);
    doc.text(text(note), LEFT, 812, line);
    doc.fillColor('#000000');
    doc.page.margins.bottom = bottom;
  }
}

export interface RenderOptions {
  fontPath: string | null;
  /** Printed under every page number. */
  footnote: string;
  /** Written into the PDF keywords: see contractKeywords. */
  keywords?: string;
  /** Signatures drawn on the copy: none on the unsigned contract. */
  stamps?: SignatureStamp[];
}

/** The production contract as a PDF: unsigned without stamps, otherwise the same pages with the signatures drawn in. */
export function renderContractPdf(c: ContractDraft, options: RenderOptions): Promise<Buffer> {
  const { fontPath } = options;
  const text = pdfText(fontPath);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 70, left: LEFT, right: LEFT },
    bufferPages: true,
    info: {
      Title: `Hop dong san xuat phim ${c.contractNo}`,
      ...(options.keywords ? { Keywords: options.keywords } : {}),
    },
  });
  if (fontPath) doc.font(fontPath);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(12).text(text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'), { align: 'center' });
  doc.fontSize(11).text(text('Độc lập - Tự do - Hạnh phúc'), { align: 'center' });
  doc.fontSize(10).text('-----o0o-----', { align: 'center' });
  doc.moveDown(1.2).fontSize(16).text(text('HỢP ĐỒNG SẢN XUẤT PHIM'), { align: 'center' });
  doc.fontSize(10).text(text(`Số: ${c.contractNo}/HĐSX-AIC`), { align: 'center' });
  doc.moveDown(0.8).fontSize(10).text(text('Căn cứ:'));
  for (const basis of LEGAL_BASES) doc.text(text(`- ${basis}`), { indent: 14, align: 'justify' });
  doc.moveDown(0.5).text(text(`Hôm nay, ngày ${c.day}, tại ${c.place}, chúng tôi gồm:`));
  party(doc, 'BÊN A (Bên đặt hàng)', c.partyA, text);
  party(doc, 'BÊN B (Bên sản xuất)', c.partyB, text);
  doc
    .moveDown(0.6)
    .fontSize(10)
    .text(
      text(
        'Sau khi thương lượng trên Hệ thống AI Cinema, hai bên thống nhất ký kết Hợp đồng sản xuất phim với các điều khoản sau:',
      ),
      { align: 'justify' },
    );
  for (const [heading, paragraphs] of articles(c)) {
    doc.moveDown(0.6).fontSize(11).text(text(heading));
    doc.fontSize(10);
    for (const p of paragraphs) doc.text(text(p), { align: 'justify' });
  }
  signatures(doc, c, text, options.stamps ?? []);
  annex(doc, c, text);
  footers(doc, c, text, options.footnote);
  doc.end();
  return done;
}
