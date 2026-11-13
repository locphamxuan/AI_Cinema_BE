import { ForbiddenException } from '@nestjs/common';
import { CODE_GUESS_LIMIT, CODE_GUESS_LOCK_MS, CODE_GUESS_WINDOW_MS } from './room-events';

/** Base32 without the look-alikes 0/O and 1/I (edge 4.1), shown as XXX-XXX. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** A fresh room code, stored without the dash: `formatRoomCode` adds it for people. */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** AB2CD9 → AB2-CD9; older 7-char codes are shown as they are. */
export function formatRoomCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** What a member typed → the stored form: uppercased, dashes and spaces dropped. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

/**
 * Edge 4.1 — brute-force guard on join-by-code: 5 wrong codes inside 10 minutes lock that member
 * out of the code box for 15 minutes. In-memory on purpose: a lock that survives a restart is not
 * worth a table, and the global rate limiter still stands in front of it.
 */
export class CodeGuessLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly lockedUntil = new Map<string, number>();

  assertNotLocked(key: string, now = Date.now()): void {
    const until = this.lockedUntil.get(key);
    if (until && until > now) {
      throw new ForbiddenException({
        message: 'Nhập sai mã phòng quá nhiều lần, vui lòng thử lại sau 15 phút',
        details: { reason: 'CODE_GUESS_LOCKED', retryAfterSeconds: Math.ceil((until - now) / 1000) },
      });
    }
    if (until) this.lockedUntil.delete(key);
  }

  recordFailure(key: string, now = Date.now()): void {
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < CODE_GUESS_WINDOW_MS);
    recent.push(now);
    this.failures.set(key, recent);
    if (recent.length >= CODE_GUESS_LIMIT) {
      this.lockedUntil.set(key, now + CODE_GUESS_LOCK_MS);
      this.failures.delete(key);
    }
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
