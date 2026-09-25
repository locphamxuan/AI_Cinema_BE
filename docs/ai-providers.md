# AI providers

Every generation job is routed to one model of `src/modules/ai-model/ai-model-catalog.ts` (the Creator never picks it).
`RoutingAiGenerationProvider` then sends the job to that model's service — or to the mock (sample library).

**Only free tiers are wired in, so running the platform never costs money**, whoever sets the keys or turns live mode on.

| Catalog model | Jobs | Service | Env key | Output stored at |
| --- | --- | --- | --- | --- |
| `gemini-2.5-flash-lite` | SCRIPT, SUBTITLE, TRANSLATION | Gemini API free tier | `GEMINI_API_KEY` | `contentText` |
| `gemini-2.5-flash-preview-tts` | VOICE | Gemini API free tier | `GEMINI_API_KEY` | R2 (wav) |
| `stable-diffusion-3-medium` | SCENE_IMAGE, POSTER, THUMBNAIL | Hugging Face Inference | `HF_TOKEN` | R2 (jpg) |
| `ltx-video-distilled` | SCENE_VIDEO | Hugging Face Space `Lightricks/ltx-video-distilled` (ZeroGPU) | `HF_TOKEN` | R2 (mp4) |
| `sample-music` | BACKGROUND_AUDIO | none — no free music model is served | — | mock |

## Modes

- `AI_PROVIDER_MODE=mock` (default): nothing is called. Use it for development and tests.
- `AI_PROVIDER_MODE=live`: every service whose key is set is called; the others stay on the mock.
  Voice-over, images and video also need the R2 bucket, since their output is copied there.
- When a free quota is used up (Gemini 429, Hugging Face 402/429, ZeroGPU daily GPU time), the job
  falls back to the mock instead of failing. Any other error (e.g. a revoked key) fails the job.

The startup log says which models are live: `Live AI models: gemini-2.5-flash-lite, …; the rest use the mock`.

## Getting the keys

Put them in `.env` only — never in `.env.example` (it is committed), chats or issues.

- **Gemini** — https://aistudio.google.com/apikey → *Create API key* in a project **without billing**.
  Without billing Google only serves the free quota and answers 429 beyond it; it can never charge.
- **Hugging Face** — https://huggingface.co/settings/tokens → *Create new token*, type **Read**.
- **Cloudflare R2** — dashboard → R2 → create a bucket → Settings → enable the *Public Development URL*
  (`S3_PUBLIC_BASE_URL`); *Manage API tokens* → *Object Read & Write* for the bucket
  (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`); endpoint `https://<account-id>.r2.cloudflarestorage.com`.

## Limits of the free tiers

- A video clip is 4 seconds by default (`HF_VIDEO_SECONDS`, 1–8) and takes about 15–60 seconds;
  the request that runs the job waits for it. ZeroGPU gives each account a few minutes of GPU a day.
- Hugging Face gives free accounts a small monthly Inference credit; images stop once it is spent
  and fall back to the mock until it renews.
- Genre Style LoRA adapters are not applied to Stable Diffusion 3 images yet.

## Production tokens

The tokens a Reviewer allocates are the platform's own production credits, not money:
`tokenCostOf()` charges `outputUnits × tokensPerUnit` of the catalog (BR-41). Text is billed per
100 output tokens, speech and video per second, an image per frame.
