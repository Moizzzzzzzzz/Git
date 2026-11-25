-- NULL means historical/unspecified; no existing order is reclassified.
CREATE TYPE "RequiredStandardMode" AS ENUM ('FACTORY', 'CUSTOMER_REQUIRED');
ALTER TABLE "vcans_orders" ADD COLUMN "requiredStandardMode" "RequiredStandardMode";
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_required_mode_frozen_source_check" CHECK (
  "requiredStandardMode" IS NULL OR "frozenRuleSource" IS NULL OR
  ("requiredStandardMode" = 'FACTORY' AND "frozenRuleSource" = 'FACTORY') OR
  ("requiredStandardMode" = 'CUSTOMER_REQUIRED' AND "frozenRuleSource" = 'CUSTOMER' AND "customerId" IS NOT NULL AND "customerStandardId" IS NOT NULL AND "customerVersionId" IS NOT NULL)
);
CREATE FUNCTION vcans_preserve_frozen_required_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."frozenRuleSource" IS NOT NULL AND NEW."requiredStandardMode" IS DISTINCT FROM OLD."requiredStandardMode" THEN
  RAISE EXCEPTION 'frozen order required standard mode cannot be changed' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_frozen_required_mode_immutable BEFORE UPDATE ON "vcans_orders" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_frozen_required_mode();
