import { CodeChallengeMethod } from '@prisma/client';
import { describeScopes, parseScopes, permissionsOfScopes, rolesForScopes } from './oauth-scopes';
import { deriveChallenge, hashAuthorizationCode, isValidCodeChallenge, newAuthorizationCode, verifyPkce } from './pkce';

/** RFC 7636 Appendix B test vector. */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('PKCE (RFC 7636)', () => {
  it('derives the S256 challenge of the RFC test vector', () => {
    expect(deriveChallenge(VERIFIER)).toBe(CHALLENGE);
    expect(isValidCodeChallenge(CHALLENGE)).toBe(true);
  });

  it('verifies only S256 and only the matching verifier', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE, CodeChallengeMethod.S256)).toBe(true);
    expect(verifyPkce(VERIFIER, VERIFIER, CodeChallengeMethod.PLAIN)).toBe(false);
    expect(verifyPkce(`${VERIFIER.slice(0, -1)}x`, CHALLENGE, CodeChallengeMethod.S256)).toBe(false);
    expect(verifyPkce('too-short', CHALLENGE, CodeChallengeMethod.S256)).toBe(false);
  });

  it('mints 256-bit codes and stores only their hash', () => {
    const code = newAuthorizationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashAuthorizationCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAuthorizationCode(code)).not.toContain(code);
  });
});

describe('OAuth scopes', () => {
  it('accepts only known scopes and maps studio:portal to the STUDIO role and permission', () => {
    expect(parseScopes('studio:portal studio:portal')).toEqual(['studio:portal']);
    expect(parseScopes('studio:portal admin')).toBeNull();
    expect(parseScopes('  ')).toBeNull();
    expect(rolesForScopes(['studio:portal'])).toEqual(['STUDIO']);
    expect([...permissionsOfScopes(['studio:portal'])]).toEqual(['studio:portal']);
    expect(describeScopes(['studio:portal'])[0].description).toContain('hợp đồng');
  });
});
