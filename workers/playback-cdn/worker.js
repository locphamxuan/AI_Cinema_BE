/**
 * Edge gate in front of MinIO for `/public/hls/*`.
 *
 * - Verifies `?s=<sessionId>&exp=<unix>&sig=HMAC_SHA256(PLAYBACK_URL_SECRET,
 *   sessionId|assetId|exp)` where assetId is the 3rd path segment (a UUID).
 * - Proxies verified requests to ORIGIN_BASE (MinIO gateway) and caches full GETs
 *   by path: segments for a year, playlists for 10s, subtitles for an hour.
 * - Passes Range through for players (partial bodies are never cached), keeps the
 *   origin's 5xx status visible for alerting, and adds public CORS headers.
 * - Anything malformed, unsigned, expired or tampered ends here with 403/404 and
 *   never reaches MinIO.
 *
 * Deploy: `wrangler deploy` with PLAYBACK_URL_SECRET + ORIGIN_BASE set (see README.md).
 */

const encoder = new TextEncoder();
// Shape-only UUID check: enough to reject junk before it can reach the origin.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/public/hls/')) return text('Not found', 404);

    const assetId = url.pathname.split('/')[3];
    if (!assetId || !UUID_PATTERN.test(assetId)) return text('Not found', 404);
    if (!(await valid(url.searchParams, assetId, env.PLAYBACK_URL_SECRET))) {
      return text('Forbidden', 403);
    }

    const range = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, request);
    // A range request must not hit (or fill) the full-body cache: a 206 slice served
    // for a normal request would truncate playback, and vice versa.
    if (!range) {
      const hit = await cache.match(cacheKey);
      if (hit) return decorate(hit, url.pathname);
    }

    const headers = new Headers();
    if (range) headers.set('Range', range);
    if (ifRange) headers.set('If-Range', ifRange);

    let origin;
    try {
      origin = await fetch(env.ORIGIN_BASE + url.pathname, { method: request.method, headers });
    } catch (error) {
      // Keep fetch failures distinct from a real 404 so operators can alert on them.
      console.error('playback origin unreachable', url.pathname, error);
      return text('Bad gateway', 502);
    }
    if (!origin.ok) {
      if (origin.status >= 500) console.error('playback origin error', origin.status, url.pathname);
      return text(origin.status === 404 ? 'Not found' : 'Origin error', origin.status);
    }

    const response = decorate(origin, url.pathname);
    if (request.method === 'GET' && !range && origin.status === 200) {
      const put = cache.put(cacheKey, response.clone());
      if (ctx?.waitUntil) ctx.waitUntil(put);
      else await put;
    }
    return response;
  },
};

function text(body, status) {
  return new Response(body, { status, headers: { ...CORS } });
}

export async function valid(params, assetId, secret) {
  const sessionId = params.get('s');
  const exp = Number(params.get('exp'));
  const sig = (params.get('sig') ?? '').toLowerCase();
  if (!sessionId || !Number.isInteger(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (exp * 1000 <= Date.now()) return false;
  if (!secret) return false;
  const expected = await hmacHex(secret, `${sessionId}|${assetId}|${exp}`);
  return timingSafeEqual(expected, sig);
}

/**
 * P2-3: compare the two fixed-length hex digests in constant time, like the API's
 * timingSafeEqual, instead of short-circuiting on the first differing character.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

function decorate(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  headers.set('Cache-Control', cacheControl(pathname));
  headers.set('Content-Type', contentType(pathname));
  return new Response(response.body, { status: response.status, headers });
}
