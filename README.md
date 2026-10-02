# AI Cinema — Backend

[![CI/CD](https://github.com/locphamxuan/AI_Cinema_BE/actions/workflows/ci.yml/badge.svg)](https://github.com/locphamxuan/AI_Cinema_BE/actions/workflows/ci.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=locphamxuan_AI_Cinema_BE&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=locphamxuan_AI_Cinema_BE)

NestJS 11 + Prisma 7 (PostgreSQL) API of AI Cinema. MF-1 — *Movie Project Management &
Publishing* — is implemented end to end: movies are commissioned from studios outside the
platform, delivered, reviewed, labeled as AI content, checked for compliance, priced in Coin,
released and browsed in the public catalog. The business rules (BR-xx) live in the root
`docs/PROJECT_OVERVIEW.md`.

## Run it

Requires Node.js 20.19+. Pick one of the two ways.

### A. Docker (Postgres + Redis + API, nothing else to install)

```bash
cp .env.example .env          # set JWT_SECRET; DATABASE_URL is ignored by compose
docker compose up -d --build  # migrates, seeds, then serves http://localhost:3001/api
docker compose logs -f api
docker compose down           # add -v to wipe the database
```

The database is published on `localhost:54320` (`postgres` / `postgres`, db `ai_cinema`), Redis on
`localhost:63790`. The API container runs media processing on the Redis queue and has FFmpeg.

### B. Node on your machine

```bash
npm ci                      # also generates the Prisma client (postinstall)
cp .env.example .env        # set DATABASE_URL and JWT_SECRET
npx prisma migrate deploy   # create or update the schema
npx prisma db seed          # genres, permissions, legal policies, demo accounts
npm run start:local         # http://localhost:3001/api, Swagger on /api/docs
```

The seed creates `creator01`..`08`, `reviewer01`..`06`, `staff01`, `admin` and `member01`
`@aicinema.com`, all signing in with `SEED_USER_PASSWORD` (default `Aicinema@123`). Existing
accounts keep their password. Public registration always creates a `MEMBER` (18+, BR-54).

The baseline migration of 2026-10-01 expects an **empty** database: a database still holding the
old self-production schema has to be reset once (`npx prisma migrate reset`, development only).

## Tests

```bash
npm test                    # unit tests
npm run test:cov            # with coverage → coverage/lcov.info
npm run lint                # ESLint + Prettier (autofix), max 300 lines per file

npm run test:e2e:db         # throwaway Postgres on localhost:54329 (tmpfs)
npm run test:e2e            # migrate + seed it, then the whole MF-1 flow
npm run test:e2e:cov        # with coverage → coverage-e2e/lcov.info (floor: 65% lines)
npm run test:e2e:db:down
```

The e2e suite only connects to `E2E_DATABASE_URL` and refuses any non-local host. It runs the
media pipeline as a mock, so FFmpeg is not needed for tests.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | What it checks |
| --- | --- |
| Lint, typecheck, unit tests, build | ESLint + Prettier without autofix, `tsc`, unit tests with coverage, `nest build` |
| E2E tests (Postgres) | the e2e suite with coverage against a Postgres service, then that `prisma/schema` matches the migrations |
| Dependency audit | no high or critical vulnerability in production dependencies |
| SonarCloud analysis | bugs, vulnerabilities, code smells, duplication and the merged unit + e2e coverage; fails when the quality gate fails |
| Docker image | builds the `runtime` image; on `main` or a `v*` tag, once everything above is green, pushes it to `ghcr.io/locphamxuan/ai_cinema_be` and calls the deploy hook |

Repository settings (*Settings → Secrets and variables → Actions*):

- `SONAR_TOKEN` (secret) — without it the analysis is skipped, everything else still runs.
- `SONAR_HOST_URL` (variable) — only for a self-hosted SonarQube; defaults to SonarCloud.
- `DEPLOY_HOOK_URL` (secret, optional) — e.g. a Render or Railway deploy hook, called after the
  image is pushed. The deployed container runs `npx prisma migrate deploy` first if the host
  allows a release command; otherwise run the `migrate` target of the Dockerfile.

### Set up SonarCloud (once)

1. Sign in to https://sonarcloud.io with GitHub and import `locphamxuan/AI_Cinema_BE`.
2. In the project, *Administration → Analysis Method*: turn **Automatic Analysis off** (the CI
   analysis carries the coverage).
3. *My Account → Security*: generate a token, save it as the `SONAR_TOKEN` repository secret.
4. If the organization or project key differ from `sonar-project.properties`, change them there.

### Analyse locally (self-hosted SonarQube)

```bash
docker compose -f docker-compose.sonar.yml up -d     # http://localhost:9000, admin / admin
# create a project "locphamxuan_AI_Cinema_BE" and a token in the UI, then:
npm run test:cov && npm run test:e2e:db && npm run test:e2e:cov
npx @sonar/scan -Dsonar.host.url=http://localhost:9000 -Dsonar.token=<token>
```

`@sonar/scan` is SonarSource's scanner on npm; it downloads its own Java runtime the first time.

## Code layout

```
src/
  common/          auth, permissions, HTTP envelope and validation helpers
  config/          typed configuration, checked at start-up
  infrastructure/  Prisma, object storage (local / S3-R2), job queue (BullMQ or in-process), mailer
  modules/<name>/  controller (HTTP only), services (one transaction per write), dto/, *.spec.ts
prisma/            schema/*.prisma (one file per area), migrations/, seed.ts
test/              e2e suite (supertest against a real Postgres)
```

## MF-1 modules

| Module | Steps | What it does |
| --- | --- | --- |
| `movie-project`, `production-fee` | 1–2 | projects, seasons, episodes, idea files, Token production fee, Admin change proposals (BR-55) |
| `studio-handoff` | 3–4 | hand-off to a studio with a brief PDF by email, studio changes, deadlines and overdue alerts |
| `media-ingest` | 5–7 | deliveries by upload, HLS link or import URL (SSRF-safe), FFmpeg HLS ladder, link checks |
| `content-review` | 8–11 | review, AI label (BR-40) and the four compliance items (BR-42) |
| `publishing` | 12–16 | Coin price and price alerts (BR-47), scheduling, releases, take-downs to fix or for good (BR-56) |
| `catalog` | — | public catalog for Guests and Members (BR-07) |

The publish gate (BR-19) is also enforced by database triggers, so no code path can release an
episode without an approved, labeled, compliant and priced version.

## Background work

| What | How it runs | Settings |
| --- | --- | --- |
| Media processing | With `REDIS_URL` deliveries are queued (BullMQ, retries) and the client polls `GET /media-assets/:id`; without Redis they run inside the request. | `REDIS_URL`, `MEDIA_PIPELINE`, `MEDIA_CONCURRENCY` |
| Scheduled releases | due releases are published every 30 s | `PUBLICATION_SWEEP_MS` (0 = off) |
| Overdue episodes | episodes past their due date are flagged once | `OVERDUE_SWEEP_MS` |
| External HLS links | links of approved episodes are re-checked; a dead link is reported | `HLS_CHECK_MS` |
