-- Historical records remain UNKNOWN and are not inferred as TEST or FORMAL.
CREATE TYPE "DataPurpose" AS ENUM ('UNKNOWN', 'TEST', 'FORMAL');
ALTER TABLE "standard_versions" ADD COLUMN "purpose" "DataPurpose" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "inspection_templates" ADD COLUMN "purpose" "DataPurpose" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "fabrics" ADD COLUMN "purpose" "DataPurpose" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "vcans_orders" ADD COLUMN "purpose" "DataPurpose" NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "customerStandardId" UUID;
ALTER TABLE "qc_tasks" ADD COLUMN "purpose" "DataPurpose" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "standard_versions" ADD CONSTRAINT "formal_standard_not_dev_default" CHECK (NOT ("purpose" = 'FORMAL' AND "isDevDefault"));
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_customer_standard_fkey" FOREIGN KEY ("customerStandardId") REFERENCES "quality_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "qc_reviews" ADD COLUMN "finalResult" "JudgeResult", ADD COLUMN "finalReason" TEXT;
ALTER TABLE "qc_reviews" ADD CONSTRAINT "review_final_quality_check" CHECK (
  ("finalResult" IS NULL AND "finalReason" IS NULL) OR
  ("decision" = 'APPROVE' AND "finalResult" IS NOT NULL AND "finalResult" IN ('PASS', 'FAIL') AND "finalReason" IS NOT NULL AND "finalReason" ~ '[^[:space:]]')
);
