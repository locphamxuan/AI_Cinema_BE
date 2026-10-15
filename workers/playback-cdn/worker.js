/**
 * Edge gate in front of MinIO for `/public/hls/*`.
 *
 * - Verifies `?s=<sessionId>&exp=<unix>&sig=HMAC_SHA256(PLAYBACK_URL_SECRET,
 *   sessionId|assetId|exp)` where assetId is the 3rd path segment.
 * - Proxies verified requests to ORIGIN_BASE (MinIO gateway) and caches by path:
 *   segments immutable for a year, playlists for 10s, subtitles for an hour.
 * - Anything unsigned, expired or tampered ends here with 403 and never reaches MinIO.
 *
 * Deploy: `wrangler deploy` with PLAYBACK_URL_SECRET + ORIGIN_BASE set (see README.md).
 */

const encoder = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/public/hls/')) return new Response('Not found', { status: 404 });

    const assetId = url.pathname.split('/')[3];
    const params = url.searchParams;
    if (!assetId || !(await valid(params, assetId, env.PLAYBACK_URL_SECRET))) {
      return new Response('Forbidden', { status: 403 });
    }

    const cacheKey = new Request(url.origin + url.pathname, request);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return withCacheControl(hit, url.pathname);

    const origin = await fetch(env.ORIGIN_BASE + url.pathname, { method: 'GET' });
    if (!origin.ok) return new Response('Not found', { status: origin.status });
    const response = withCacheControl(
      new Response(origin.body, { status: 200, headers: { 'Content-Type': contentType(url.pathname) } }),
      url.pathname,
    );
    const put = cache.put(cacheKey, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else await put;
    return response;
  },
};

export async function valid(params, assetId, secret) {
  const sessionId = params.get('s');
  const exp = Number(params.get('exp'));
  const sig = (params.get('sig') ?? '').toLowerCase();
  if (!sessionId || !Number.isInteger(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (exp * 1000 <= Date.now()) return false;
  if (!secret) return false;
  const expected = await hmacHex(secret, `${sessionId}|${assetId}|${exp}`);
  return expected === sig;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function contentType(pathname) {
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (pathname.endsWith('.ts')) return 'video/mp2t';
  if (pathname.endsWith('.vtt')) return 'text/vtt';
  return 'application/octet-stream';
}

function cacheControl(pathname) {
  if (pathname.endsWith('.ts')) return 'public, max-age=31536000, immutable';
  if (pathname.endsWith('.m3u8')) return 'public, max-age=10';
  if (pathname.endsWith('.vtt')) return 'public, max-age=3600';
  return 'public, max-age=86400';
}

function withCacheControl(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', cacheControl(pathname));
  return new Response(response.body, { status: response.status, headers });
}
