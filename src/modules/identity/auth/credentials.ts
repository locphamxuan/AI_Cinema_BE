import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const PASSWORD_SALT_ROUNDS = 12;

// Compared against when the email is unknown, so a missing account answers as slowly as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', PASSWORD_SALT_ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}

/** A refresh token: 256 random bits, of which only the SHA-256 hash is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
