-- OAuth 2.0 Authorization Code + PKCE (RFC 6749 §4.1, RFC 7636, RFC 9700): AI Cinema becomes the
-- authorization server the third-party Studio Web logs in through. A studio signs in on our domain with its
-- STUDIO account, approves a consent screen, and Studio Web exchanges a one-time code for tokens server-side.
-- Hand-written: the CHECK constraints below are invisible to `prisma migrate diff`.

-- CreateEnum
CREATE TYPE "CodeChallengeMethod" AS ENUM ('S256', 'PLAIN');

-- Registered clients ------------------------------------------------------------------------------------------
CREATE TABLE "oauth_clients" (
    "id" UUID NOT NULL,
    "client_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "redirect_uris" TEXT[],
    "scopes" TEXT[],
    "client_secret_hash" VARCHAR(255),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");
-- A client with no redirect_uri could never receive a code, and one with no scope could never ask for anything.
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_redirect_uris_check"
    CHECK (array_length("redirect_uris", 1) >= 1 AND array_length("scopes", 1) >= 1);

-- One-time authorization codes ---------------------------------------------------------------------------------
CREATE TABLE "authorization_codes" (
    "id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "client_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" VARCHAR(500) NOT NULL,
    "redirect_uri" VARCHAR(500) NOT NULL,
    "code_challenge" VARCHAR(255) NOT NULL,
    "code_challenge_method" "CodeChallengeMethod" NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "authorization_codes_code_hash_key" ON "authorization_codes"("code_hash");
CREATE INDEX "authorization_codes_user_id_created_at_idx" ON "authorization_codes"("user_id", "created_at");
CREATE INDEX "authorization_codes_expires_at_idx" ON "authorization_codes"("expires_at");
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A code lives for a minute: it may never be stored already expired, and PKCE is never optional here.
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_pkce_check"
    CHECK (length("code_challenge") >= 43 AND "expires_at" > "created_at");

-- Sessions opened through the OAuth token endpoint ---------------------------------------------------------------
ALTER TABLE "refresh_tokens"
    ADD COLUMN "oauth_client_id" UUID,
    ADD COLUMN "scope" VARCHAR(500);
CREATE INDEX "refresh_tokens_oauth_client_id_idx" ON "refresh_tokens"("oauth_client_id");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_oauth_client_id_fkey"
    FOREIGN KEY ("oauth_client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A token of an OAuth client always carries the scopes it was granted, and a plain login never carries any:
-- that is what stops a scoped refresh token from being swapped for an unscoped session at /auth/refresh.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_oauth_scope_check"
    CHECK (("oauth_client_id" IS NULL) = ("scope" IS NULL));
