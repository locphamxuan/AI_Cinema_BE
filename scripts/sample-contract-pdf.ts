import PDFDocument from 'pdfkit';
import { pdfText, unicodeFontPath } from '../src/infrastructure/pdf/unicode-font';
import { articles, LEGAL_BASES, money, type Party, type SampleContract } from './sample-contract-clauses';

export type { SampleContract } from './sample-contract-clauses';

/** Who signs a counterpart: only that side's box carries a signature and stamp, the other stays empty. */
export type SampleSide = 'ADMIN' | 'STUDIO';

type Text = (value: string) => string;
const LEFT = 56;
const WIDTH = 483;

/** A drawn placeholder squiggle — obviously a sample, never an imitation of a real signature. */
function drawSignature(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc
    .save()
    .lineWidth(1.2)
    .strokeColor('#1a3d8f')
    .moveTo(x, y + 14)
    .bezierCurveTo(x + 18, y - 6, x + 30, y + 26, x + 48, y + 6)
    .bezierCurveTo(x + 62, y - 8, x + 74, y + 20, x + 96, y + 2)
    .stroke()
    .moveTo(x + 6, y + 20)
    .lineTo(x + 86, y + 18)
    .stroke()
    .restore();
}

/** A round red stamp reading "MẪU DEMO": shows where the seal goes without copying any real seal. */
function drawStamp(doc: PDFKit.PDFDocument, x: number, y: number, name: string, text: Text): void {
  doc.save().lineWidth(1.5).strokeColor('#c0392b').fillColor('#c0392b');
  doc.circle(x, y, 34).stroke().circle(x, y, 28).stroke();
  // The seal shows the short trade name: "Công ty TNHH Lumen Studio (giả lập)" -> "LUMEN STUDIO".
  const short = name
    .replace(/^Công ty TNHH\s*/i, '')
    .replace(/\(.*\)/, '')
    .replace(/^Nền tảng Phim\s*/i, '')
    .trim();
  doc.fontSize(7).text(text(short.toUpperCase()), x - 26, y - 12, { width: 52, align: 'center' });
  doc.fontSize(8).text(text('MẪU DEMO'), x - 26, y + 4, { width: 52, align: 'center' });
  doc.restore();
}

function party(doc: PDFKit.PDFDocument, label: string, p: Party, text: Text): void {
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

function annex(doc: PDFKit.PDFDocument, c: SampleContract, text: Text): void {
  doc.addPage();
  doc.fontSize(13).text(text('PHỤ LỤC 01'), { align: 'center' });
  doc.fontSize(11).text(text(`DANH SÁCH TẬP PHIM VÀ HẠN GIAO (kèm Hợp đồng số ${c.contractNo})`), { align: 'center' });
  doc.moveDown();
  const cols = [LEFT, LEFT + 50, LEFT + 260, LEFT + 360];
  const head = ['Tập', 'Tên tập', 'Thời lượng', 'Hạn giao'];
  const row = (cells: string[], y: number) =>
    cells.forEach((cell, i) => doc.text(text(cell), cols[i] + 4, y + 5, { width: 200 }));
  const tableTop = doc.y;
  let y = tableTop;
  doc.fontSize(10);
  doc.rect(LEFT, y, WIDTH, 22).stroke();
  row(head, y);
  for (const e of c.episodes) {
    y += 22;
    doc.rect(LEFT, y, WIDTH, 22).stroke();
    row([String(e.number), e.title, `${e.minutes} phút`, e.dueDate], y);
  }
  cols.slice(1).forEach((x) =>
    doc
      .moveTo(x, tableTop)
      .lineTo(x, y + 22)
      .stroke(),
  );
  doc.text(text(`Tổng số tập: ${c.episodes.length}. Giá trị Hợp đồng: ${money(c.costVnd)}.`), LEFT, y + 34, {
    width: WIDTH,
  });
}

function signatures(doc: PDFKit.PDFDocument, c: SampleContract, side: SampleSide, text: Text): void {
  if (doc.y > 600) doc.addPage();
  const top = doc.y + 24;
  const right = 320;
  doc.fontSize(11);
  doc.text(text('ĐẠI DIỆN BÊN A'), LEFT, top, { width: 220, align: 'center' });
  doc.text(text('ĐẠI DIỆN BÊN B'), right, top, { width: 220, align: 'center' });
  doc.fontSize(9).fillColor('#555555');
  doc.text(text('(Ký, ghi rõ họ tên, đóng dấu)'), LEFT, top + 15, { width: 220, align: 'center' });
  doc.text(text('(Ký, ghi rõ họ tên, đóng dấu)'), right, top + 15, { width: 220, align: 'center' });
  doc.fillColor('#000000');
  const x = side === 'ADMIN' ? LEFT : right;
  const signer = side === 'ADMIN' ? c.partyA : c.partyB;
  drawStamp(doc, x + 70, top + 70, signer.name, text);
  drawSignature(doc, x + 90, top + 52);
  doc.fontSize(11);
  doc.text(text(c.partyA.representative), LEFT, top + 120, { width: 220, align: 'center' });
  doc.text(text(c.partyB.representative), right, top + 120, { width: 220, align: 'center' });
  doc.fontSize(9).text(text(c.partyA.title), LEFT, top + 136, { width: 220, align: 'center' });
  doc.text(text(c.partyB.title), right, top + 136, { width: 220, align: 'center' });
}

function footers(doc: PDFKit.PDFDocument, c: SampleContract, text: Text): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit open a new page: lift the margin for the footer.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#777777');
    doc.text(text(`Hợp đồng số ${c.contractNo} — Trang ${i + 1}/${range.count}`), LEFT, 800, {
      width: WIDTH,
      align: 'center',
      lineBreak: false,
    });
    doc.text(
      text('Văn bản mẫu phục vụ demo đồ án; tên đơn vị, mã số thuế, chữ ký và con dấu đều là dữ liệu giả lập.'),
      LEFT,
      812,
      {
        width: WIDTH,
        align: 'center',
        lineBreak: false,
      },
    );
    doc.fillColor('#000000');
    doc.page.margins.bottom = bottom;
  }
}

/** One counterpart of the demo contract: the same document, signed and stamped by one side only. */
export function renderSampleContract(c: SampleContract, side: SampleSide): Promise<Buffer> {
  const fontPath = unicodeFontPath(null);
  const text = pdfText(fontPath);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 70, left: LEFT, right: LEFT },
    bufferPages: true,
    info: { Title: `Hop dong san xuat phim ${c.contractNo}` },
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
  signatures(doc, c, side, text);
  annex(doc, c, text);
  footers(doc, c, text);
  doc.end();
  return done;
}
