/**
 * Edge gate in front of the Cloudflare R2 bucket for `/public/hls/*`.
 *
 * - Verifies `?s=<sessionId>&exp=<unix>&sig=HMAC_SHA256(PLAYBACK_URL_SECRET,
 *   sessionId|assetId|exp)` where assetId is the 3rd path segment (a UUID).
 * - Reads verified objects straight from the R2 binding (MEDIA_BUCKET), so the bucket
 *   stays private: with no public r2.dev URL and no public custom domain, this Worker is
 *   the only way in and the token can never be walked around. ORIGIN_BASE stays as an
 *   HTTP-origin fallback for a local MinIO during development.
 * - Caches full GETs by path: segments for a year, playlists for 10s, subtitles for an hour.
 * - Serves Range requests as 206 (partial bodies are never cached), answers conditional
 *   requests, and adds public CORS headers.
 * - Anything malformed, unsigned, expired or tampered ends here with 403/404 and never
 *   reaches the bucket.
 *
 * Deploy: `wrangler deploy` with PLAYBACK_URL_SECRET set and the r2_buckets binding
 * pointing at the bucket (see README.md).
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
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, request);
    // A range request must not hit (or fill) the full-body cache: a 206 slice served
    // for a normal request would truncate playback, and vice versa.
    if (!range) {
      const hit = await cache.match(cacheKey);
      if (hit) return decorate(hit, url.pathname);
    }

    let origin;
    try {
      origin = env.MEDIA_BUCKET
        ? await fromBucket(env.MEDIA_BUCKET, url.pathname.slice(1), request)
        : await fromOrigin(env.ORIGIN_BASE, url.pathname, request);
    } catch (error) {
      // Keep read failures distinct from a real 404 so operators can alert on them.
      console.error('playback origin unreachable', url.pathname, error);
      return text('Bad gateway', 502);
    }
    if (!origin.ok && origin.status !== 206 && origin.status !== 304) {
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

/**
 * Reads the object from the private R2 bucket. `range`/`onlyIf` take the request headers
 * directly, and R2 reports back which slice it returned so the 206 carries a correct
 * Content-Range - a player seeking inside a segment depends on it.
 */
export async function fromBucket(bucket, key, request) {
  const conditional = request.headers.get('If-None-Match') ?? request.headers.get('If-Match');
  const object = await bucket.get(key, {
    range: request.headers.has('Range') ? request.headers : undefined,
    onlyIf: conditional ? request.headers : undefined,
  });
  if (object === null) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  // R2 returns an R2Object with no body when a precondition fails.
  if (!('body' in object)) {
    return new Response(null, { status: request.headers.get('If-None-Match') ? 304 : 412, headers });
  }
  const slice = contentRange(object);
  if (!slice) return new Response(object.body, { status: 200, headers });
  headers.set('Content-Range', slice.header);
  headers.set('Content-Length', String(slice.length));
  return new Response(object.body, { status: 206, headers });
}

/** `bytes <start>-<end>/<size>` for the slice R2 actually returned, or null for a full body. */
function contentRange(object) {
  const range = object.range;
  if (!range) return null;
  const size = object.size;
  const start = 'suffix' in range ? size - range.suffix : (range.offset ?? 0);
  const length = 'suffix' in range ? range.suffix : (range.length ?? size - start);
  if (start === 0 && length === size) return null;
  return { header: `bytes ${start}-${start + length - 1}/${size}`, length };
}

/** Development fallback: a plain HTTP origin (local MinIO) instead of the R2 binding. */
async function fromOrigin(originBase, pathname, request) {
  const headers = new Headers();
  for (const name of ['Range', 'If-Range', 'If-None-Match']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return fetch(originBase + pathname, { method: request.method, headers });
}

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

// Kept in step with contentTypeOf()/cacheControlOf() in src/infrastructure/storage/object-storage.ts,
// so an object carries the same type and TTL whether it is served from the edge or the origin.
const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
};
const SEGMENT_EXTENSIONS = ['.ts', '.m4s', '.mp4'];

function extensionOf(pathname) {
  const dot = pathname.lastIndexOf('.');
  return dot >= 0 ? pathname.slice(dot).toLowerCase() : '';
}

function contentType(pathname) {
  return TYPES[extensionOf(pathname)] ?? 'application/octet-stream';
}

function cacheControl(pathname) {
  const extension = extensionOf(pathname);
  // Segments never change once transcoded; a take-down purges them instead of waiting them out.
  if (SEGMENT_EXTENSIONS.includes(extension)) return 'public, max-age=31536000, immutable';
  if (extension === '.m3u8') return 'public, max-age=10';
  if (extension === '.vtt') return 'public, max-age=3600';
  return 'public, max-age=86400';
}

function decorate(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  headers.set('Cache-Control', cacheControl(pathname));
  headers.set('Content-Type', contentType(pathname));
  return new Response(response.body, { status: response.status, headers });
}
