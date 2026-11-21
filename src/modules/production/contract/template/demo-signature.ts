import type { ContractSide, SignatureMark } from './contract-template-pdf';

/**
 * Demo signing for the MF-1 walk-through: a drawn squiggle and a red "MẪU DEMO" seal in the box of one side.
 * Obviously a sample, never an imitation of a real signature or seal, and only ever used by the demo seed and
 * `npm run contracts:sign-demo`; the contract the studio receives from the API is never marked.
 */
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

/** The seal shows the short trade name: "Công ty TNHH Lumen Studio" -> "LUMEN STUDIO". */
export function sealName(name: string): string {
  return name
    .replace(/^Công ty (TNHH|Cổ phần|CP)\s*/i, '')
    .replace(/\(.*\)/, '')
    .trim()
    .toUpperCase();
}

function drawSeal(doc: PDFKit.PDFDocument, x: number, y: number, name: string, text: (value: string) => string): void {
  doc.save().lineWidth(1.5).strokeColor('#c0392b').fillColor('#c0392b');
  doc.circle(x, y, 34).stroke().circle(x, y, 28).stroke();
  doc.fontSize(7).text(text(sealName(name)), x - 26, y - 12, { width: 52, align: 'center' });
  doc.fontSize(8).text(text('MẪU DEMO'), x - 26, y + 4, { width: 52, align: 'center' });
  doc.restore();
}

export const demoMark = (side: ContractSide): SignatureMark => ({
  side,
  draw: (doc, box, text) => {
    drawSeal(doc, box.x + 70, box.y + 70, box.partyName, text);
    drawSignature(doc, box.x + 90, box.y + 52);
  },
});
