# playback-cdn Worker (MF-3 phase 2)

Edge gate between players and the Cloudflare R2 bucket. Verifies the API's signed token
(`?s=&exp=&sig=`, HMAC-SHA256 over `sessionId|assetId|exp`) on every
`/public/hls/*` request, proxies valid ones to R2, caches by path.

## Deploy

1. `wrangler secret put PLAYBACK_URL_SECRET` — same value as the API's env.
2. Set `ORIGIN_BASE` in `wrangler.toml` — public origin of the R2 bucket
   (`https://pub-xxxx.r2.dev` or the bucket's custom domain).
3. Add the `routes` line for the CDN domain (= API `STORAGE_PUBLIC_BASE_URL`).
4. `wrangler deploy`.

## Test vector

- secret `test-secret`, message `sess-1|00000000-0000-4000-8000-000000000001|2000000000`
- `node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('sess-1|00000000-0000-4000-8000-000000000001|2000000000').digest('hex'))"`
  → `cda353ff69ce01510989fad924a2a432cf96f82d1f71cd0af1d2b7217ae07b9c`
- The Worker must accept `?s=sess-1&exp=2000000000&sig=<that hex>` on
  `/public/hls/00000000-0000-4000-8000-000000000001/720p/index.m3u8`, 403
  anything tampered/expired, and 404 a non-UUID asset id.

## Notes

- Token binds the session, not the path: one token opens master, variants and
  segments of that asset until `exp` (default 1h, `PLAYBACK_URL_TTL_SECONDS`).
  The API re-signs child URLs on every master/variant serve, so active playback
  slides forward while a leaked link expires within the TTL.
- Revocation is expiry-based: `POST /sessions/:id/stop` stops the player from
  refreshing, and playlist endpoints re-check the session row on every load.
- P2-4: the third path segment must be a UUID; `Range` (and `If-Range`) pass
  through and 206 bodies bypass the cache; origin 5xx stays visible (fetch
  failures become 502); responses carry `Access-Control-Allow-Origin: *` for
  future browser players.
- Local dev needs no Worker: `STORAGE_PUBLIC_BASE_URL` points at the API's
  `/media` and the static server ignores the query string.
