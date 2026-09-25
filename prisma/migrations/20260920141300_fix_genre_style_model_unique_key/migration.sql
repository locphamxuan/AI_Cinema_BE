-- Fix: a genre can have several distinct named styles on the same base
-- AiModel, so uniqueness must key off (base_ai_model_id, trigger_keyword,
-- version), not (genre_id, base_ai_model_id, version).
DROP INDEX "genre_style_models_genre_id_base_ai_model_id_version_key";

CREATE UNIQUE INDEX "genre_style_models_base_ai_model_id_trigger_keyword_version_key" ON "genre_style_models"("base_ai_model_id", "trigger_keyword", "version");
