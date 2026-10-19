# playback-cdn Worker (MF-3 phase 2)

Edge gate between players and MinIO. Verifies the API's signed token
(`?s=&exp=&sig=`, HMAC-SHA256 over `sessionId|assetId|exp`) on every
`/public/hls/*` request, proxies valid ones to MinIO, caches by path.

## Deploy

1. `wrangler secret put PLAYBACK_URL_SECRET` — same value as the API's env.
2. Set `ORIGIN_BASE` in `wrangler.toml` — public gateway of the MinIO bucket.
3. Add the `routes` line for the CDN domain (= API `STORAGE_PUBLIC_BASE_URL`).
4. `wrangler deploy`.

## Test vector (mirrors `playback-url.service.spec.ts`)

- secret `test-secret`, message `sess-1|asset-1|2000000000`
- `node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('sess-1|asset-1|2000000000').digest('hex'))"`
- The Worker must accept `?s=sess-1&exp=2000000000&sig=<that hex>` on
  `/public/hls/asset-1/720p/index.m3u8` and 403 anything tampered or expired.

## Notes

- Token binds the session, not the path: one token opens master, variants and
  segments of that asset until `exp` (default 1h, `PLAYBACK_URL_TTL_SECONDS`).
  The API re-signs child URLs on every master/variant serve, so active playback
  slides forward while a leaked link expires within the TTL.
- Revocation is expiry-based: `POST /sessions/:id/stop` stops the player from
  refreshing, and playlist endpoints re-check the session row on every load.
- Local dev needs no Worker: `STORAGE_PUBLIC_BASE_URL` points at the API's
  `/media` and the static server ignores the query string.
