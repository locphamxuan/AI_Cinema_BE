# playback-cdn Worker (MF-3 phase 2)

Edge gate between players and the **private** Cloudflare R2 bucket. Verifies the API's signed
token (`?s=&exp=&sig=`, HMAC-SHA256 over `sessionId|assetId|exp`) on every `/public/hls/*`
request, reads the object through the R2 binding, and caches it by path.

## Deploy

1. `wrangler secret put PLAYBACK_URL_SECRET` — same value as the API's env.
2. Uncomment the `[[r2_buckets]]` block in `wrangler.toml` and set `bucket_name` to the
   bucket that holds `public/hls/*`.
3. Add the `routes` line for the CDN domain (= API `CDN_BASE_URL`).
4. `wrangler deploy`.

Leave the bucket private: do **not** enable its r2.dev URL and do **not** attach a public
custom domain to the bucket itself. The custom domain belongs to this Worker, not to R2.
`ORIGIN_BASE` exists only for local development against a plain HTTP origin (MinIO); when
`MEDIA_BUCKET` is bound it is ignored.

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
  slides forward while a leaked link expires within the TTL. This is why the design
  does not use S3 presigned URLs: those sign one object each, and an episode has
  thousands of segments.
- Revocation is expiry-based plus a purge: `POST /sessions/:id/stop` stops the player from
  refreshing, playlist endpoints re-check the session row on every load, and a take-down
  calls Cloudflare's cache purge for `.../public/hls/<assetId>/` (see the API's
  `CdnPurgeService`).
- P2-4: the third path segment must be a UUID; `Range` is answered as a 206 built from
  R2's own `object.range` (206 bodies bypass the cache); conditional requests answer
  304/412; a read failure becomes 502.
- Local dev needs no Worker: `CDN_BASE_URL` stays empty, `STORAGE_PUBLIC_BASE_URL` points
  at the API's `/media` and the static server ignores the query string.
