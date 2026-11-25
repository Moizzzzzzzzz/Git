-- Legacy orders stay entirely NULL; freeze fields must be set together.
CREATE TYPE "VcansRuleSource" AS ENUM ('FACTORY','CUSTOMER');
ALTER TABLE "vcans_orders" ADD COLUMN "factoryVersionId" UUID, ADD COLUMN "customerVersionId" UUID, ADD COLUMN "frozenRuleSource" "VcansRuleSource", ADD COLUMN "frozenTemplateSnapshot" JSONB, ADD COLUMN "frozenTemplateVersion" INTEGER;
CREATE UNIQUE INDEX "standard_versions_id_standardId_key" ON "standard_versions"("id", "standardId");
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_frozen_factory_version_fkey" FOREIGN KEY ("factoryVersionId", "fourPointStandardId") REFERENCES "standard_versions"("id", "standardId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_frozen_customer_version_fkey" FOREIGN KEY ("customerVersionId", "customerStandardId") REFERENCES "standard_versions"("id", "standardId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_rule_freeze_complete_check" CHECK (
  ("factoryVersionId" IS NULL AND "customerVersionId" IS NULL AND "frozenRuleSource" IS NULL AND "frozenTemplateSnapshot" IS NULL AND "frozenTemplateVersion" IS NULL)
  OR
  ("frozenRuleSource" IS NOT NULL AND "frozenTemplateSnapshot" IS NOT NULL AND jsonb_typeof("frozenTemplateSnapshot") = 'object' AND "frozenTemplateVersion" IS NOT NULL AND "frozenTemplateVersion" > 0 AND "templateId" IS NOT NULL
   AND ("factoryVersionId" IS NULL OR "fourPointStandardId" IS NOT NULL)
   AND ("customerVersionId" IS NULL OR "customerStandardId" IS NOT NULL)
   AND (("frozenRuleSource" = 'FACTORY' AND "factoryVersionId" IS NOT NULL) OR ("frozenRuleSource" = 'CUSTOMER' AND "customerVersionId" IS NOT NULL)))
);
CREATE FUNCTION vcans_preserve_rule_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."frozenRuleSource" IS NOT NULL AND (
  NEW."factoryVersionId" IS DISTINCT FROM OLD."factoryVersionId" OR NEW."customerVersionId" IS DISTINCT FROM OLD."customerVersionId" OR
  NEW."frozenRuleSource" IS DISTINCT FROM OLD."frozenRuleSource" OR NEW."frozenTemplateSnapshot" IS DISTINCT FROM OLD."frozenTemplateSnapshot" OR NEW."frozenTemplateVersion" IS DISTINCT FROM OLD."frozenTemplateVersion" OR
  NEW."templateId" IS DISTINCT FROM OLD."templateId" OR NEW."fourPointStandardId" IS DISTINCT FROM OLD."fourPointStandardId" OR NEW."customerStandardId" IS DISTINCT FROM OLD."customerStandardId" OR NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
 ) THEN RAISE EXCEPTION 'activated order rule freeze cannot be changed' USING ERRCODE = '55000'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_order_rule_freeze_immutable BEFORE UPDATE ON "vcans_orders" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_rule_freeze();
-- Retiring a version is permitted; changing referenced version content or
-- identity is not. PostgreSQL row locks serialize updates with activation.
CREATE FUNCTION vcans_preserve_referenced_standard_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."rules" IS DISTINCT FROM OLD."rules" OR NEW."standardId" IS DISTINCT FROM OLD."standardId" OR NEW."version" IS DISTINCT FROM OLD."version" OR NEW."isDevDefault" IS DISTINCT FROM OLD."isDevDefault" OR NEW."purpose" IS DISTINCT FROM OLD."purpose")
 AND EXISTS (SELECT 1 FROM "vcans_orders" WHERE "factoryVersionId" = OLD."id" OR "customerVersionId" = OLD."id") THEN
  RAISE EXCEPTION 'frozen order standard version content cannot be changed' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_frozen_standard_immutable BEFORE UPDATE ON "standard_versions" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_referenced_standard_version();
