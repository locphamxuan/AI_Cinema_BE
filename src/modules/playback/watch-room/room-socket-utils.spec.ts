import type { JwtService } from '@nestjs/jwt';
import { memberOfToken } from './room-socket-utils';

describe('memberOfToken (socket handshake)', () => {
  const options = { issuer: 'ai-cinema-api', audience: 'ai-cinema' };
  const prismaOf = (account: { isActive: boolean; role: string } | null) => ({
    user: { findUnique: jest.fn().mockResolvedValue(account) },
  });
  const jwtWith = (payload: object) => ({ verifyAsync: jest.fn().mockResolvedValue(payload) }) as unknown as JwtService;

  it('admits an active Member with an access token', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({ sub: 'u1', type: 'access' });
    const jwt = { verifyAsync } as unknown as JwtService;
    await expect(memberOfToken(jwt, options, prismaOf({ isActive: true, role: 'MEMBER' }), 't')).resolves.toBe('u1');
    expect(verifyAsync).toHaveBeenCalledWith('t', expect.objectContaining(options));
  });

  it('refuses a token that is not an access token, a locked account and a staff account', async () => {
    const member = prismaOf({ isActive: true, role: 'MEMBER' });
    await expect(memberOfToken(jwtWith({ sub: 'u1', type: 'refresh' }), options, member, 't')).rejects.toThrow();
    const access = jwtWith({ sub: 'u1', type: 'access' });
    await expect(memberOfToken(access, options, prismaOf({ isActive: false, role: 'MEMBER' }), 't')).rejects.toThrow();
    await expect(memberOfToken(access, options, prismaOf({ isActive: true, role: 'ADMIN' }), 't')).rejects.toThrow();
  });
});
