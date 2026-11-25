-- Nulls preserve existing preview/committed batches without inventing results.
ALTER TABLE "vcans_import_batches" ADD COLUMN "expiresAt" TIMESTAMPTZ(3), ADD COLUMN "commitKey" TEXT, ADD COLUMN "commitHash" TEXT, ADD COLUMN "commitResult" JSONB;
CREATE UNIQUE INDEX "vcans_import_batches_businessDepartmentId_commitKey_key" ON "vcans_import_batches"("businessDepartmentId", "commitKey");
ALTER TABLE "vcans_import_batches" ADD CONSTRAINT "vcans_import_commit_complete" CHECK (
  ("commitKey" IS NULL AND "commitHash" IS NULL AND "commitResult" IS NULL) OR
  ("commitKey" IS NOT NULL AND length("commitKey") > 0 AND "commitHash" IS NOT NULL AND length("commitHash") > 0 AND "commitResult" IS NOT NULL AND "status" = 'COMMITTED')
);
CREATE FUNCTION vcans_preserve_commit_result() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."commitKey" IS NOT NULL AND (NEW."commitKey" IS DISTINCT FROM OLD."commitKey" OR NEW."commitHash" IS DISTINCT FROM OLD."commitHash" OR NEW."commitResult" IS DISTINCT FROM OLD."commitResult" OR NEW."businessDepartmentId" IS DISTINCT FROM OLD."businessDepartmentId") THEN
    RAISE EXCEPTION 'VCANS committed import result cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_import_commit_immutable BEFORE UPDATE ON "vcans_import_batches" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_commit_result();
CREATE FUNCTION vcans_preserve_committed_import_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."commitKey" IS NOT NULL THEN
    RAISE EXCEPTION 'VCANS committed import cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER vcans_import_commit_no_delete BEFORE DELETE ON "vcans_import_batches" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_committed_import_delete();
