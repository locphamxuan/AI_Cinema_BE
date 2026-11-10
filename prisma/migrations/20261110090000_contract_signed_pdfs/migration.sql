-- Signed contract PDFs (2026-11-10): MF-1 drops click-to-sign. The Admin uploads a PDF of the contract
-- carrying its signature and the studio uploads its own counterpart of the same agreed cost; the system then
-- merges both into one FINAL document holding the two signatures. The negotiation rounds, the statuses and
-- the "both signatures before production" gate are unchanged: admin_signed_at / studio_signed_at now record
-- when that side's counterpart was uploaded.

-- CreateEnum
CREATE TYPE "ContractDocumentSide" AS ENUM ('ADMIN', 'STUDIO', 'FINAL');

-- CreateTable
CREATE TABLE "contract_documents" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "side" "ContractDocumentSide" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "size_bytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_contract_id_side_key" ON "contract_documents"("contract_id", "side");

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECKs ---------------------------------------------------------------------------------------------------
-- Hand-written, invisible to `prisma migrate diff`: only real PDFs of a sane size are ever recorded, and the
-- FINAL document is the system's own work, never an upload of one side.
ALTER TABLE "contract_documents"
    ADD CONSTRAINT "contract_documents_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520),
    ADD CONSTRAINT "contract_documents_mime_check" CHECK ("mime_type" = 'application/pdf'),
    ADD CONSTRAINT "contract_documents_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "contract_documents_final_author_check" CHECK ("side" <> 'FINAL' OR "uploaded_by_id" IS NULL);

-- Permissions ------------------------------------------------------------------------------------------------
-- The Admin and the Reviewer of the project read the signed PDFs; the studio reads its own through
-- /studio-portal. The seed only fills a role that has none yet.
INSERT INTO "permissions" ("key", "area", "description")
SELECT 'contract:document.read', 'movie-project', 'Download the signed contract PDFs of a project'
WHERE EXISTS (SELECT 1 FROM "role_permissions")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role", "permission_key")
SELECT "role", 'contract:document.read'
FROM (VALUES ('ADMIN'::"UserRole"), ('CONTENT_REVIEWER'::"UserRole")) AS seed("role")
WHERE EXISTS (SELECT 1 FROM "role_permissions" AS existing WHERE existing."role" = seed."role")
ON CONFLICT DO NOTHING;
