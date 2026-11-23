-- MF-1 signing by signature image (2026-11-22): each side uploads an image of its signature instead of a signed
-- PDF; the system draws it into the contract template, so the studio-signed copy and the FINAL copy have exactly
-- the layout of the unsigned contract. The rendered copies stay in "contract_documents".

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "side" "ContractDocumentSide" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "signer_name" VARCHAR(255) NOT NULL,
    "signer_title" VARCHAR(100) NOT NULL,
    "signed_at" TIMESTAMPTZ(6) NOT NULL,
    "uploaded_by_id" UUID,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_signatures_contract_id_side_key" ON "contract_signatures"("contract_id", "side");

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECKs (hand-written, invisible to `prisma migrate diff`): a signature belongs to one party, never to the
-- FINAL copy, and only a small PNG/JPEG of a sane size is ever recorded.
ALTER TABLE "contract_signatures"
    ADD CONSTRAINT "contract_signatures_side_check" CHECK ("side" <> 'FINAL'),
    ADD CONSTRAINT "contract_signatures_mime_check" CHECK ("mime_type" IN ('image/png', 'image/jpeg')),
    ADD CONSTRAINT "contract_signatures_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152),
    ADD CONSTRAINT "contract_signatures_dimensions_check" CHECK ("width" BETWEEN 1 AND 4000 AND "height" BETWEEN 1 AND 4000),
    ADD CONSTRAINT "contract_signatures_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$');

-- Studio legal profile (2026-11-22): the studio fills in its own Bên B on Studio Web; the bank name is kept apart
-- from the account number, which is digits only from now on.
ALTER TABLE "studios" ADD COLUMN "bank_name" VARCHAR(255);
