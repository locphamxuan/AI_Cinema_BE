import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes in base64url: what a studio portal link carries. */
export const PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh link token; only its hash is stored on the hand-off. */
export function newPortalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashPortalToken(token) };
}

export function portalUrl(webAppUrl: string, token: string): string {
  return `${webAppUrl}/studio/${token}`;
}

/** The lines added to a brief email so the studio can answer and deliver. */
export function portalEmailLines(url: string): string[] {
  return [
    'Cổng studio (link riêng của quý studio, vui lòng không chia sẻ):',
    url,
    'Tại đây quý studio xác nhận nhận dự án, giao từng tập kèm cam kết sử dụng AI và xem góp ý của AI Cinema.',
  ];
}
