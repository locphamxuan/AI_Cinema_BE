import { BadRequestException } from '@nestjs/common';

/** A file kind accepted by an upload endpoint, recognised by its first bytes, not by what the client claims. */
export interface FileKind {
  mimeType: string;
  extensions: string[];
  matches: (head: Buffer) => boolean;
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const startsWith = (head: Buffer, ...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

export const FILE_KINDS = {
  pdf: { mimeType: 'application/pdf', extensions: ['.pdf'], matches: (h) => startsWith(h, 0x25, 0x50, 0x44, 0x46) },
  docx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    matches: (h) => startsWith(h, 0x50, 0x4b, 0x03, 0x04),
  },
  png: { mimeType: 'image/png', extensions: ['.png'], matches: (h) => startsWith(h, 0x89, 0x50, 0x4e, 0x47) },
  jpeg: { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], matches: (h) => startsWith(h, 0xff, 0xd8, 0xff) },
  webp: {
    mimeType: 'image/webp',
    extensions: ['.webp'],
    matches: (h) => startsWith(h, 0x52, 0x49, 0x46, 0x46) && h.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  mp4: {
    mimeType: 'video/mp4',
    extensions: ['.mp4', '.m4v'],
    matches: (h) => h.subarray(4, 8).toString('latin1') === 'ftyp',
  },
  mov: {
    mimeType: 'video/quicktime',
    extensions: ['.mov'],
    matches: (h) => ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(h.subarray(4, 8).toString('latin1')),
  },
  vtt: {
    mimeType: 'text/vtt',
    extensions: ['.vtt'],
    // A UTF-8 byte order mark may precede the WEBVTT signature.
    matches: (h) => h.toString('utf8').replace(BYTE_ORDER_MARK, '').startsWith('WEBVTT'),
  },
} satisfies Record<string, FileKind>;

/** Strips folders and odd characters from a client file name, keeping its extension. */
export function safeFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(-200);
}

/** The kind of an uploaded file, or 415 when neither its extension nor its content is accepted. */
export function detectKind(fileName: string, head: Buffer, accepted: FileKind[]): FileKind {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const kind = accepted.find((candidate) => candidate.extensions.includes(extension) && candidate.matches(head));
  if (!kind) {
    const allowed = accepted.flatMap((candidate) => candidate.extensions).join(', ');
    throw new BadRequestException(`The file must be one of ${allowed}, and its content must match its extension`);
  }
  return kind;
}
