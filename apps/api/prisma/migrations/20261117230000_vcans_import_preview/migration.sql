-- Older batches remain NULL; no historical preview is inferred.
ALTER TABLE "vcans_import_batches" ADD COLUMN "previewSummary" JSONB;
CREATE FUNCTION vcans_preserve_preview_summary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."previewSummary" IS NOT NULL AND NEW."previewSummary" IS DISTINCT FROM OLD."previewSummary" THEN
    RAISE EXCEPTION 'VCANS persisted preview cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_import_preview_immutable BEFORE UPDATE ON "vcans_import_batches" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_preview_summary();
