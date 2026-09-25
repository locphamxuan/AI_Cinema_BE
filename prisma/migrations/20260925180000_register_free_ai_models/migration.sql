-- Production now runs only on free-tier AI services (Gemini, Hugging Face), so no one can
-- spend money through the platform. The paid providers are switched off; their models stay
-- registered for the jobs that already point to them.

UPDATE "ai_providers" SET "is_active" = false WHERE "name" IN ('OpenAI', 'ElevenLabs', 'fal.ai');

INSERT INTO "ai_providers" ("id", "name", "is_active")
VALUES (gen_random_uuid(), 'Google', true), (gen_random_uuid(), 'Hugging Face', true), (gen_random_uuid(), 'AI Cinema', true)
ON CONFLICT ("name") DO UPDATE SET "is_active" = true;

INSERT INTO "ai_models" ("id", "ai_provider_id", "name", "version", "modality")
SELECT gen_random_uuid(), p."id", m.name, m.version, m.modality::"AiModality"
FROM (VALUES
    ('Google', 'gemini-2.5-flash-lite', '2.5', 'TEXT'),
    ('Google', 'gemini-2.5-flash-preview-tts', '2.5-preview', 'AUDIO'),
    ('AI Cinema', 'sample-music', '1', 'AUDIO'),
    ('Hugging Face', 'stable-diffusion-3-medium', '3-medium', 'IMAGE'),
    ('Hugging Face', 'ltx-video-distilled', '0.9.7', 'VIDEO')
) AS m(provider, name, version, modality)
JOIN "ai_providers" p ON p."name" = m.provider
ON CONFLICT ("ai_provider_id", "name", "version") DO NOTHING;
