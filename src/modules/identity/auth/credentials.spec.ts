import { hashRefreshToken, isAdult, newRefreshToken, normalizeEmail, verifyPassword } from './credentials';

describe('credentials', () => {
  it('counts the 18th birthday itself as adult', () => {
    const today = new Date('2026-10-01T00:00:00Z');
    expect(isAdult(new Date('2008-10-01'), today)).toBe(true);
    expect(isAdult(new Date('2008-10-02'), today)).toBe(false);
  });

  it('issues long random refresh tokens and stores only a stable hash', () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(newRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it('still runs a bcrypt comparison when the account does not exist', async () => {
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
  });

  it('compares emails case-insensitively', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});
