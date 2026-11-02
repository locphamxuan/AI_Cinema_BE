-- VNPay is the only payment gateway. Fails, changing nothing, if a row still names the retired value.
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";

CREATE TYPE "PaymentProvider" AS ENUM ('VNPAY');

ALTER TABLE "payments"
  ALTER COLUMN "provider" TYPE "PaymentProvider" USING ("provider"::text::"PaymentProvider");

ALTER TABLE "payment_callbacks"
  ALTER COLUMN "provider" TYPE "PaymentProvider" USING ("provider"::text::"PaymentProvider");

DROP TYPE "PaymentProvider_old";
