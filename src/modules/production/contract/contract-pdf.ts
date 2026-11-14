import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import PDFKitDocument from 'pdfkit';
import { businessStamp } from 'src/common/time/business-day';
import { pdfText } from 'src/infrastructure/pdf/unicode-font';

/** What the closing page of the merged contract states about the round both sides signed. */
export interface SignedSummary {
  contractId: string;
  round: number;
  movieTitle: string;
  studioName: string;
  costVnd: bigint | number;
  adminName: string;
  adminSignedAt: Date;
  studioSignedAt: Date;
}

/** A counterpart may not be a 500-page scan: both sides sign the same short contract. */
export const MAX_CONTRACT_PAGES = 40;

const vnd = (amount: bigint | number) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;

/** Loads an uploaded counterpart, turning anything pdf-lib cannot read into a 400 instead of a 500. */
async function loadCounterpart(file: Buffer, side: string): Promise<PDFDocument> {
  try {
    const pdf = await PDFDocument.load(file, { updateMetadata: false });
    const pages = pdf.getPageCount();
    if (pages === 0) throw new BadRequestException(`The ${side} PDF has no pages`);
    if (pages > MAX_CONTRACT_PAGES) {
      throw new BadRequestException(`The ${side} PDF has ${pages} pages; at most ${MAX_CONTRACT_PAGES} are accepted`);
    }
    return pdf;
  } catch (error) {
    // A damaged, encrypted or empty file is the uploader's mistake, never a 500.
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`The ${side} PDF cannot be read; upload an unprotected, unencrypted PDF`);
  }
}

/**
 * The page the system adds to the merged document: it names both signature blocks, the agreed cost and when
 * each counterpart arrived, so the one final PDF reads as a complete contract rather than two loose files.
 */
export function renderClosingPage(summary: SignedSummary, fontPath: string | null): Promise<Buffer> {
  const text = pdfText(fontPath);
  const doc = new PDFKitDocument({
    size: 'A4',
    margin: 56,
    info: { Title: `Hop dong - ${summary.contractId}`, CreationDate: summary.studioSignedAt },
  });
  if (fontPath) doc.font(fontPath);
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(16).text(text('XÁC NHẬN HỢP ĐỒNG ĐÃ ĐỦ CHỮ KÝ HAI BÊN'), { align: 'center' });
  doc.moveDown().fontSize(11);
  doc.text(text(`Phim: ${summary.movieTitle}`));
  doc.text(text(`Studio sản xuất: ${summary.studioName}`));
  doc.text(text(`Vòng thương lượng: ${summary.round}`));
  doc.text(text(`Chi phí sản xuất đã thống nhất: ${vnd(summary.costVnd)}`));
  doc.text(text(`Mã hợp đồng: ${summary.contractId}`));
  doc.moveDown().fontSize(10);
  doc.text(
    text(
      'Tài liệu này gồm bản hợp đồng có chữ ký của AI Cinema và bản hợp đồng có chữ ký của Studio cho cùng ' +
        'mức chi phí nêu trên. Hai bản được hệ thống ghép lại thành một văn bản duy nhất mang đủ hai chữ ký.',
    ),
    { align: 'justify' },
  );
  doc.moveDown(1.5).fontSize(11);
  doc.text(text(`ĐẠI DIỆN AI CINEMA: ${summary.adminName}`));
  doc.text(text(`Đã tải lên bản ký: ${businessStamp(summary.adminSignedAt)}`));
  doc.moveDown();
  doc.text(text(`ĐẠI DIỆN STUDIO: ${summary.studioName}`));
  doc.text(text(`Đã tải lên bản ký: ${businessStamp(summary.studioSignedAt)}`));
  doc.end();
  return done;
}

/**
 * The one final PDF holding both signatures: the Admin's signed counterpart, then the studio's, then the
 * closing page the system draws. Nothing random goes in and the dates come from the contract, so the same
 * two uploads always merge into the same bytes.
 */
export async function mergeSignedCounterparts(
  counterparts: { admin: Buffer; studio: Buffer },
  summary: SignedSummary,
  fontPath: string | null,
): Promise<Buffer> {
  const merged = await PDFDocument.create();
  merged.setTitle(`Hop dong ${summary.contractId} - du chu ky hai ben`);
  merged.setProducer('AI Cinema');
  merged.setCreator('AI Cinema');
  merged.setCreationDate(summary.adminSignedAt);
  merged.setModificationDate(summary.studioSignedAt);

  const closing = await renderClosingPage(summary, fontPath);
  const sources: [Buffer, string][] = [
    [counterparts.admin, 'Admin'],
    [counterparts.studio, 'Studio'],
    [closing, 'closing'],
  ];
  for (const [file, side] of sources) {
    const source = await loadCounterpart(file, side);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return Buffer.from(await merged.save({ useObjectStreams: false }));
}

/** 400s unless the upload is a PDF pdf-lib can open and of a sane length; returns its page count. */
export async function assertUsableCounterpart(file: Buffer, side: string): Promise<number> {
  const pdf = await loadCounterpart(file, side);
  return pdf.getPageCount();
}
