import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { assertPlaybackToken, playbackSignature } from './playback-token';

const SECRET = 'test-secret';
const future = () => Math.floor(Date.now() / 1000) + 600;
const signed = (exp: number, assetId = 'a1', sessionId = 's1') => ({
  sessionId,
  exp,
  sig: playbackSignature(SECRET, sessionId, assetId, exp),
});

describe('playback-token', () => {
  it('accepts a token signed for this session and asset, in any hex case', () => {
    const token = signed(future());
    expect(() => assertPlaybackToken(token, 'a1', SECRET)).not.toThrow();
    expect(() => assertPlaybackToken({ ...token, sig: token.sig.toUpperCase() }, 'a1', SECRET)).not.toThrow();
  });

  it('binds the signature to the asset', () => {
    expect(() => assertPlaybackToken(signed(future(), 'other'), 'a1', SECRET)).toThrow(ForbiddenException);
  });

  it('refuses malformed and expired tokens', () => {
    expect(() => assertPlaybackToken({ sessionId: 's1', exp: 1.5, sig: 'ab' }, 'a1', SECRET)).toThrow(
      BadRequestException,
    );
    expect(() => assertPlaybackToken(signed(1000), 'a1', SECRET)).toThrow(ForbiddenException);
  });

  it('answers 422 when signing is not configured', () => {
    expect(() => assertPlaybackToken(signed(future()), 'a1', undefined)).toThrow(UnprocessableEntityException);
  });
});
