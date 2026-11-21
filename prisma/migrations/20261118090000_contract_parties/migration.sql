-- MF-1 contract template (18/11/2026): the legal identity of both parties comes from the database, not the code.
-- Bên A: kept by the Admin in the platform settings.
ALTER TABLE "platform_settings"
  ADD COLUMN "contract_company_name" VARCHAR(255),
  ADD COLUMN "contract_address" VARCHAR(500),
  ADD COLUMN "contract_tax_code" VARCHAR(50),
  ADD COLUMN "contract_phone" VARCHAR(30),
  ADD COLUMN "contract_email" VARCHAR(255),
  ADD COLUMN "contract_bank_account" VARCHAR(255),
  ADD COLUMN "contract_representative" VARCHAR(255),
  ADD COLUMN "contract_representative_title" VARCHAR(100),
  ADD COLUMN "contract_place" VARCHAR(255);

-- Bên B: kept by the Admin in the studio catalogue.
ALTER TABLE "studios"
  ADD COLUMN "address" VARCHAR(500),
  ADD COLUMN "tax_code" VARCHAR(50),
  ADD COLUMN "bank_account" VARCHAR(255),
  ADD COLUMN "representative_title" VARCHAR(100);
