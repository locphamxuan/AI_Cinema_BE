import {
  generateOtp,
  hashOtp,
  hashRefreshToken,
  isAdult,
  newRefreshToken,
  normalizeEmail,
  otpEquals,
  verifyPassword,
} from './credentials';

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

  it('generates a zero-padded numeric OTP of the requested length', () => {
    const otp = generateOtp(6);
    expect(otp).toMatch(/^\d{6}$/);
    // padding: a small random value still has 6 digits
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
  });

  it('hashes an OTP deterministically with SHA-256', () => {
    const otp = '123456';
    expect(hashOtp(otp)).toBe(hashOtp(otp));
    expect(hashOtp(otp)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtp(otp)).not.toBe(otp);
  });

  it('compares OTPs in constant time and rejects mismatches', () => {
    const otp = '123456';
    const stored = hashOtp(otp);
    expect(otpEquals(otp, stored)).toBe(true);
    expect(otpEquals('000000', stored)).toBe(false);
    expect(otpEquals('12345', stored)).toBe(false);
    // malformed hash length mismatch does not throw
    expect(otpEquals(otp, 'abc')).toBe(false);
  });
});
