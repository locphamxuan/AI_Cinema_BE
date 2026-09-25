# AI providers

Every generation job is routed to one model of `src/modules/ai-model/ai-model-catalog.ts` (the Creator never picks it).
`RoutingAiGenerationProvider` then sends the job to that model's real API — or to the mock.

| Catalog model | Jobs | Provider | Env key | Output stored at |
| --- | --- | --- | --- | --- |
| `gpt-4o-mini` | SCRIPT, SUBTITLE, TRANSLATION | OpenAI | `OPENAI_API_KEY` | `contentText` |
| `flux-dev` (+ Genre Style LoRA) | SCENE_IMAGE, POSTER, THUMBNAIL | fal.ai | `FAL_KEY` | fal.ai CDN URL |
| `eleven_multilingual_v2`, `eleven_music` | VOICE, BACKGROUND_AUDIO | ElevenLabs | `ELEVENLABS_API_KEY` | S3 bucket (mp3) |
| `veo-3` | SCENE_VIDEO | Google Gemini API | `GEMINI_API_KEY` | S3 bucket (mp4) |

## Modes

- `AI_PROVIDER_MODE=mock` (default): no paid call is ever made (LI-01). Use it for development, tests and demos.
- `AI_PROVIDER_MODE=live`: each provider whose key is set is called for real; the others stay on the mock,
  so any subset of keys works. ElevenLabs and Veo also need the S3 bucket, since they return raw bytes.

The startup log says which providers are live: `Live AI providers: OpenAI, fal.ai; the rest use the mock`.

## Getting the keys

Put them in `.env` only — never commit them or paste them into chats or issues.

- **OpenAI** — platform.openai.com → API keys → *Create new secret key*. Add billing credit first.
- **fal.ai** — fal.ai/dashboard/keys → *Add key* (scope API). Add credit under Billing.
- **ElevenLabs** — elevenlabs.io → Developers → API keys. The music endpoint needs a paid plan.
- **Google Gemini (Veo)** — aistudio.google.com/apikey → *Create API key*. Veo needs a billing-enabled project.
- **Storage (Cloudflare R2)** — Cloudflare dashboard → R2 → create a bucket → Settings → enable the public
  `r2.dev` URL (`S3_PUBLIC_BASE_URL`); R2 → *Manage API tokens* → create an *Object Read & Write* token for the bucket
  (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`); the S3 endpoint is `https://<account-id>.r2.cloudflarestorage.com`.
  Any other S3-compatible store works with the same variables.

## Cost and limits

- Veo is by far the most expensive call (billed per generated second) and takes 1–6 minutes; the request that runs the
  job waits for it (up to 10 minutes). Keep it on the mock unless a real clip is needed.
- Token cost charged to the plan's quota still follows `tokenCostOf()` (BR-41): output length × `tokensPerUnit`.
  Text is billed per 100 completion tokens, speech/music/video per second, an image per frame.
