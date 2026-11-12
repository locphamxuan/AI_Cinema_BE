import { existsSync } from 'node:fs';

// Fonts with Vietnamese glyphs: the Docker image ships DejaVu Sans, Windows has Arial, macOS Supplemental.
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

/** The first readable Unicode font, starting with the configured one (BRIEF_FONT_PATH); null when there is none. */
export function unicodeFontPath(configured: string | null): string | null {
  return [configured, ...FONT_CANDIDATES].find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

/**
 * Without a Unicode font pdfkit falls back to Helvetica, which cannot draw Vietnamese marks: drop the marks
 * rather than print garbage. The text stays readable, which is all a server-rendered document needs.
 */
export function foldToAscii(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/** `text => text` when a font is available, the ASCII fold otherwise. */
export function pdfText(fontPath: string | null): (value: string) => string {
  return fontPath ? (value: string) => value : foldToAscii;
}
