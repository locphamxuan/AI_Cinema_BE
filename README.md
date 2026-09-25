# AI Cinema — Backend

NestJS 11 + Prisma 7 (PostgreSQL) API of AI Cinema. MF-1 (AI movie production & publishing)
is implemented end to end; the business rules live in the root `docs/PROJECT_OVERVIEW.md`.

## Run it

Requires Node.js 20.19+. Pick one of the two ways.

### A. Docker (Postgres + API, nothing else to install)

```bash
cp .env.example .env          # set JWT_SECRET; DATABASE_URL is ignored by compose
docker compose up -d --build  # migrates, seeds, then serves http://localhost:3001/api
docker compose logs -f api
docker compose down           # add -v to wipe the database
```

The database is published on `localhost:54320` (`postgres` / `postgres`, db `ai_cinema`).

### B. Node on your machine

```bash
npm ci                      # also generates the Prisma client (postinstall)
cp .env.example .env        # set DATABASE_URL and JWT_SECRET
npx prisma migrate deploy   # create or update the schema
npx prisma db seed          # genres, policies, AI model catalog, demo accounts
npm run start:local         # http://localhost:3001/api, Swagger on /api/docs
```

`DATABASE_URL` can point at the team database, or at the local one of `docker compose up -d postgres`
(`postgresql://postgres:postgres@localhost:54320/ai_cinema`).

The seed creates `creator01`..`08`, `reviewer01`..`06` and `admin` `@aicinema.com` on an empty
database, all signing in with `SEED_USER_PASSWORD` (default `Aicinema@123`). Existing accounts keep
their password. Public registration always creates a `MEMBER`. The frontend proxies `/api` to
`http://localhost:3001`.

## Tests

```bash
npm test                    # unit tests
npm run test:cov            # with coverage (writes coverage/, git-ignored)
npm run lint                # ESLint + Prettier, max 300 lines per file

npm run test:e2e:db         # throwaway Postgres on localhost:54329 (tmpfs)
npm run test:e2e            # migrate + seed it, then the whole MF-1 flow
npm run test:e2e:db:down
```

The e2e suite only connects to `E2E_DATABASE_URL` and refuses any non-local host.

## Code layout

```
src/
  common/        auth guards, decorators, permissions, validation helpers
  prisma/        PrismaService (pg adapter)
  modules/<name>/
    <name>.controller.ts   HTTP only: routes, permissions, DTOs
    <name>.service.ts      use cases (one transaction per write)
    *.rules.ts, *-lookups.ts, *-includes.ts   pure rules, read checks, Prisma includes
    dto/                   class-validator request DTOs
    *.spec.ts              unit tests next to the code
prisma/          schema/*.prisma (one file per table), migrations/, seed.ts
test/            e2e suite (supertest against a real Postgres)
```

## AI providers

Every generation job is routed to one model of `src/modules/ai-model/ai-model-catalog.ts` (the
Creator never picks it). `RoutingAiGenerationProvider` sends the job to that model's service or to
the mock. **Only free tiers are wired in, so running the platform never costs money.**

| Catalog model | Jobs | Service | Env key |
| --- | --- | --- | --- |
| `gemini-2.5-flash-lite` | SCRIPT, SUBTITLE, TRANSLATION, Prompt Composer, scene advisor | Gemini API free tier | `GEMINI_API_KEY` |
| `gemini-2.5-flash-preview-tts` | VOICE | Gemini API free tier | `GEMINI_API_KEY` |
| `stable-diffusion-3-medium` | SCENE_IMAGE, POSTER, THUMBNAIL | Hugging Face Inference | `HF_TOKEN` |
| `ltx-video-distilled` | SCENE_VIDEO | Hugging Face Space (ZeroGPU) | `HF_TOKEN` |
| `sample-music` | BACKGROUND_AUDIO | none, always the mock | — |

- `AI_PROVIDER_MODE=mock` (default) calls nothing. `live` calls every service whose key is set;
  voice, images and video also need the S3/R2 bucket (`S3_*`), where their output is stored.
- A used-up free quota fails the job **without charging** production tokens; any other provider
  error fails it too. Without a Gemini key the Prompt Composer and scene advisor use templates.
- Keys go in `.env` only. Gemini: https://aistudio.google.com/apikey in a project **without
  billing**. Hugging Face: a **Read** token. Cloudflare R2: bucket + *Object Read & Write* token.
- Production tokens are the platform's own credits, not money: `tokenCostOf()` charges
  `outputUnits × tokensPerUnit` of the catalog (BR-41).

## Renamed migrations (2026-09-25)

A database that applied the two genre-style migrations under their old names needs this once:

```sql
UPDATE _prisma_migrations SET migration_name = '20260920141200_add_genre_style_model'
  WHERE migration_name = '20260920073113_add_genre_style_model';
UPDATE _prisma_migrations SET migration_name = '20260920141300_fix_genre_style_model_unique_key'
  WHERE migration_name = '20260920073500_fix_genre_style_model_unique_key';
```
