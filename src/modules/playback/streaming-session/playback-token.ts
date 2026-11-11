import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PlaybackToken {
  sessionId: string;
  exp: number;
  sig: string;
}

export function playbackSignature(secret: string, sessionId: string, assetId: string, exp: number): string {
  return createHmac('sha256', secret).update(`${sessionId}|${assetId}|${exp}`).digest('hex');
}

/** Refuses a token that is malformed, expired or not signed for this session and asset. */
export function assertPlaybackToken(token: PlaybackToken, assetId: string, secret: string | undefined): void {
  if (!secret) {
    throw new UnprocessableEntityException({
      message: 'Signed playback is not configured',
      details: { reason: 'PLAYBACK_SIGNING_DISABLED' },
    });
  }
  if (!Number.isInteger(token.exp) || !/^[0-9a-f]{64}$/i.test(token.sig)) {
    throw new BadRequestException({
      message: 'The playback token is malformed',
      details: { reason: 'PLAYBACK_TOKEN_INVALID' },
    });
  }
  if (token.exp * 1000 <= Date.now()) {
    throw new ForbiddenException({
      message: 'The playback token has expired',
      details: { reason: 'PLAYBACK_TOKEN_EXPIRED' },
    });
  }
  const expected = playbackSignature(secret, token.sessionId, assetId, token.exp);
  if (
    expected.length !== token.sig.length ||
    !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token.sig.toLowerCase(), 'hex'))
  ) {
    throw new ForbiddenException({
      message: 'The playback token signature is invalid',
      details: { reason: 'PLAYBACK_TOKEN_INVALID' },
    });
  }
}
