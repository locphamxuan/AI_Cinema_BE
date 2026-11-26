-- Policies become plain text the Reviewer reads, keep only the three types the compliance check uses,
-- and record when each was last changed.

-- 1. COPYRIGHT and PUBLISHING were never read by any check; their rows fold into LEGAL.
UPDATE "policies" SET "type" = 'LEGAL' WHERE "type" IN ('COPYRIGHT', 'PUBLISHING');
ALTER TYPE "PolicyType" RENAME TO "PolicyType_old";
CREATE TYPE "PolicyType" AS ENUM ('AI_LABELING', 'CONTENT_POLICY', 'LEGAL');
ALTER TABLE "policies" ALTER COLUMN "type" TYPE "PolicyType" USING "type"::text::"PolicyType";
DROP TYPE "PolicyType_old";

-- 2. JSON content -> readable text: "summary" as a paragraph, lists as "- " bullets, other keys as "key: value".
ALTER TABLE "policies" ADD COLUMN "content_text" TEXT;
UPDATE "policies" p SET "content_text" = CASE
  WHEN p."content" IS NULL OR jsonb_typeof(p."content") = 'null' THEN NULL
  WHEN jsonb_typeof(p."content") = 'string' THEN p."content" #>> '{}'
  WHEN jsonb_typeof(p."content") = 'array' THEN (
    SELECT string_agg('- ' || (e #>> '{}'), E'\n') FROM jsonb_array_elements(p."content") e
  )
  WHEN jsonb_typeof(p."content") = 'object' THEN (
    SELECT string_agg(
      CASE
        WHEN kv.key = 'summary' AND jsonb_typeof(kv.value) = 'string' THEN kv.value #>> '{}'
        WHEN jsonb_typeof(kv.value) = 'array' THEN
          (CASE WHEN kv.key = 'requirements' THEN 'Yêu cầu' ELSE kv.key END) || E':\n' ||
          (SELECT string_agg('- ' || (e #>> '{}'), E'\n') FROM jsonb_array_elements(kv.value) e)
        ELSE kv.key || ': ' || (kv.value #>> '{}')
      END,
      E'\n'
      ORDER BY (kv.key <> 'summary'), kv.key
    )
    FROM jsonb_each(p."content") kv
  )
  ELSE p."content" #>> '{}'
END;
-- A policy without content shows its legal reference (or its name) so the Reviewer still has something to read.
UPDATE "policies" SET "content_text" = COALESCE(NULLIF(btrim("document_reference"), ''), "name")
WHERE "content_text" IS NULL OR btrim("content_text") = '';
ALTER TABLE "policies" DROP COLUMN "content";
ALTER TABLE "policies" RENAME COLUMN "content_text" TO "content";
ALTER TABLE "policies" ALTER COLUMN "content" SET NOT NULL;

-- 3. The three seeded policies, still untouched by an Admin, get their Vietnamese names and text.
UPDATE "policies" SET
  "name" = 'Quy định gắn nhãn nội dung do AI tạo',
  "content" = E'Mọi tập phim có phần do AI tạo hoặc chỉnh sửa phải được gắn nhãn rõ ràng khi phát cho người xem (Điều 44 Luật số 134/2025/QH15).\n- Nhãn hiện trên màn hình ở mọi tập đã phát hành.\n- Thông tin phim trong danh mục luôn ghi rõ là nội dung do AI tạo.\n- Reviewer kiểm tra nhãn trước khi tập được công khai.\n- Mọi lần gắn hoặc đổi nhãn đều được ghi lại.'
WHERE "name" = 'AI-Generated Content Labeling Policy' AND "version" = '1.0.0';
UPDATE "policies" SET
  "name" = 'Thông báo theo Nghị định 142 và người, sự kiện có thật',
  "content" = E'Nội dung dễ khiến người xem nhầm với người thật hoặc sự kiện thật phải kèm thông báo rõ ràng (Nghị định số 142/2026/NĐ-CP).\n- Không mô phỏng người có danh tính thật.\n- Nếu tập có chi tiết dễ gây hiểu nhầm, ghi rõ chỗ đó khi kiểm tra.'
WHERE "name" = 'Decree 142 Misleading-Content Notice' AND "version" = '1.0.0';
UPDATE "policies" SET
  "name" = 'Quy định an toàn nội dung',
  "content" = E'Tập phim không được chứa:\n- Bạo lực cực đoan.\n- Nội dung khiêu dâm.\n- Lời lẽ kích động thù hận.\n- Nội dung vi phạm pháp luật.'
WHERE "name" = 'Content Safety Policy' AND "version" = '1.0.0';

-- 4. Last-changed time, starting from the creation time for existing rows (Prisma sets it on every update).
ALTER TABLE "policies" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "policies" SET "updated_at" = "created_at";
ALTER TABLE "policies" ALTER COLUMN "updated_at" DROP DEFAULT;
