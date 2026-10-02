import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const PASSWORD_SALT_ROUNDS = 12;
const MINIMUM_AGE = 18;

// Compared against when the email is unknown, so a missing account answers as slowly as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', PASSWORD_SALT_ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}

/** A refresh token: 256 random bits, of which only the SHA-256 hash is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** BR-54: the platform is for adults; a birthday counts from its own date. */
export function isAdult(dateOfBirth: Date, today = new Date()): boolean {
  const birthday = new Date(
    Date.UTC(dateOfBirth.getUTCFullYear() + MINIMUM_AGE, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()),
  );
  return birthday.getTime() <= today.getTime();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
