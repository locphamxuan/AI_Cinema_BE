import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';

export interface BriefEpisode {
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  targetDurationSeconds: number;
  dueDate: Date | null;
}

export interface BriefContent {
  movieTitle: string;
  studioName: string;
  studioContact: string | null;
  creatorName: string;
  creatorEmail: string;
  ideaDescription: string;
  genres: string[];
  productionFeeTokens: number;
  tokenRateVnd: number;
  episodes: BriefEpisode[];
  ideaFiles: string[];
  issuedAt: Date;
}

// Fonts with Vietnamese glyphs: the Docker image ships DejaVu Sans, Windows has Arial.
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

export function briefFont(configured: string | null): string | null {
  return [configured, ...FONT_CANDIDATES].find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

const vnd = (amount: number) => `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;
const minutes = (seconds: number) => `${Math.round((seconds / 60) * 10) / 10} phút`;
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : '—');

// Without a Unicode font the built-in Helvetica cannot draw Vietnamese marks; drop them rather than print garbage.
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

/** The brief PDF sent to the studio (BR-13): the order, its fee in Token and VND, and every episode deadline. */
export function renderBriefPdf(brief: BriefContent, fontPath: string | null): Promise<Buffer> {
  const text = fontPath ? (value: string) => value : plain;
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Brief - ${brief.movieTitle}` } });
  if (fontPath) doc.font(fontPath);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(18).text(text(`ĐƠN ĐẶT HÀNG SẢN XUẤT PHIM — ${brief.movieTitle}`));
  doc
    .moveDown(0.5)
    .fontSize(10)
    .text(text(`Ngày phát hành brief: ${day(brief.issuedAt)}`));
  doc.moveDown();
  doc.fontSize(12).text(text(`Studio: ${brief.studioName}${brief.studioContact ? ` (${brief.studioContact})` : ''}`));
  doc.text(text(`Đầu mối AI Cinema: ${brief.creatorName} — ${brief.creatorEmail}`));
  doc.text(text(`Thể loại: ${brief.genres.join(', ')}`));
  const feeVnd = brief.productionFeeTokens * brief.tokenRateVnd;
  doc.text(text(`Phí sản xuất: ${brief.productionFeeTokens} Token (= ${vnd(feeVnd)})`));
  doc.moveDown().fontSize(13).text(text('Ý tưởng phim'));
  doc.fontSize(11).text(text(brief.ideaDescription), { align: 'justify' });

  doc.moveDown().fontSize(13).text(text('Danh sách tập và hạn giao'));
  doc.fontSize(11);
  for (const episode of brief.episodes) {
    doc.text(
      text(
        `Mùa ${episode.seasonNumber} · Tập ${episode.episodeNumber}: ${episode.title} — ${minutes(episode.targetDurationSeconds)} — hạn ${day(episode.dueDate)}`,
      ),
    );
  }

  if (brief.ideaFiles.length) {
    doc.moveDown().fontSize(13).text(text('Tài liệu đính kèm'));
    doc.fontSize(11).text(text(brief.ideaFiles.join('\n')));
  }
  doc
    .moveDown()
    .fontSize(9)
    .text(
      text(
        'Yêu cầu bàn giao: mỗi tập kèm khai báo AI (công cụ, phần do AI tạo, cam kết không mô phỏng người thật và không dùng tác phẩm có bản quyền).',
      ),
    );
  doc.end();
  return done;
}
