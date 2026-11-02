import { Injectable } from '@nestjs/common';

export interface MarkdownChunk {
  chunkIndex: number;
  /** Heading path, e.g. `Gói dịch vụ > Gói Tháng > Quyền lợi`. */
  heading: string;
  /** The heading path followed by the text, so the embedding sees the topic too. */
  content: string;
  tokenCount: number;
}

const TARGET_CHARS = 1_000;
const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 180;
const MAX_CHUNKS = 200;

interface Section {
  path: string[];
  body: string;
}

/**
 * Markdown-aware chunking (plan §4.2): cut at # / ## / ###, keep the heading path with each
 * chunk, keep Vietnamese diacritics untouched, and window long sections at 800–1.200 characters
 * with a 150–200 character overlap.
 */
@Injectable()
export class ChunkingService {
  chunk(markdown: string, rootHeading = ''): MarkdownChunk[] {
    const chunks: MarkdownChunk[] = [];

    for (const section of this.sections(markdown)) {
      const heading = [rootHeading, ...section.path].filter(Boolean).join(' > ');
      for (const piece of splitLong(section.body)) {
        if (!piece) continue;
        chunks.push({
          chunkIndex: chunks.length,
          heading,
          content: heading ? `${heading}\n\n${piece}` : piece,
          tokenCount: estimateTokens(piece),
        });
        if (chunks.length >= MAX_CHUNKS) return chunks;
      }
    }
    return chunks;
  }

  private sections(markdown: string): Section[] {
    const sections: Section[] = [];
    const path: string[] = [];
    let body: string[] = [];
    let inFence = false;

    const flush = () => {
      const text = body.join('\n').trim();
      if (text) sections.push({ path: [...path], body: text });
      body = [];
    };

    for (const line of markdown.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) inFence = !inFence;

      const heading = !inFence ? /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line) : null;
      if (!heading) {
        body.push(line);
        continue;
      }

      flush();
      const level = heading[1].length;
      path.length = level - 1;
      path[level - 1] = heading[2].trim();
    }
    flush();

    return sections;
  }
}

/** Splits one section body into 800–1.200 character windows with a small overlap. */
function splitLong(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= MAX_CHARS) return [normalized];

  const pieces: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + TARGET_CHARS, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(start + Math.floor(TARGET_CHARS / 2), end);
      const boundary = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
      );
      if (boundary > 0) end = start + Math.floor(TARGET_CHARS / 2) + boundary + 1;
    }

    const piece = normalized.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - OVERLAP_CHARS);
  }
  return pieces;
}

/** Rough token budget; Vietnamese text runs about four characters per token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
