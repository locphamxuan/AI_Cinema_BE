import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CodeChallengeMethod } from '@prisma/client';

/** RFC 7636 §4.1: `code-verifier = 43*128unreserved`, unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~". */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** A base64url SHA-256 digest is 43 characters; a challenge is never shorter or longer. */
const CODE_CHALLENGE = /^[A-Za-z0-9\-._~]{43}$/;

export function isValidCodeVerifier(verifier: string): boolean {
  return CODE_VERIFIER.test(verifier);
}

export function isValidCodeChallenge(challenge: string): boolean {
  return CODE_CHALLENGE.test(challenge);
}

/** RFC 7636 §4.2: `code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`, no padding. */
export function deriveChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * RFC 7636 §4.6. Only S256 is accepted: a PLAIN challenge is as public as the code it protects, and
 * RFC 9700 §2.1.1 tells servers that can do S256 to require it. Compared in constant time.
 */
export function verifyPkce(verifier: string, challenge: string, method: CodeChallengeMethod): boolean {
  if (method !== CodeChallengeMethod.S256 || !isValidCodeVerifier(verifier)) return false;
  const derived = Buffer.from(deriveChallenge(verifier));
  const stored = Buffer.from(challenge);
  return derived.length === stored.length && timingSafeEqual(derived, stored);
}

/** An authorization code: 256 random bits, of which only the SHA-256 hash is ever stored. */
export function newAuthorizationCode(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAuthorizationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
