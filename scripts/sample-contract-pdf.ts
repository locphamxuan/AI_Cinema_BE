import { unicodeFontPath } from '../src/infrastructure/pdf/unicode-font';
import type { ContractDraft } from '../src/modules/production/contract/template/contract-clauses';
import {
  renderContractPdf,
  type ContractSide,
  type SignatureMark,
} from '../src/modules/production/contract/template/contract-template-pdf';

const DEMO_NOTE = 'Văn bản mẫu phục vụ demo đồ án; tên đơn vị, mã số thuế, chữ ký và con dấu đều là dữ liệu giả lập.';

/** A drawn placeholder squiggle: obviously a sample, never an imitation of a real signature. */
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
function drawStamp(doc: PDFKit.PDFDocument, x: number, y: number, name: string, text: (value: string) => string): void {
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

const demoMark = (side: ContractSide): SignatureMark => ({
  side,
  draw: (doc, box, text) => {
    drawStamp(doc, box.x + 70, box.y + 70, box.partyName, text);
    drawSignature(doc, box.x + 90, box.y + 52);
  },
});

/** One counterpart of the demo contract (signed and stamped by one side), or the unsigned template. */
export function renderSampleContract(c: ContractDraft, side: ContractSide | null): Promise<Buffer> {
  return renderContractPdf(c, {
    fontPath: unicodeFontPath(null),
    footnote: DEMO_NOTE,
    mark: side ? demoMark(side) : undefined,
  });
}
