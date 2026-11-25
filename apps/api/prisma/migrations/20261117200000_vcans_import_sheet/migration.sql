-- Existing rows retain an explicit unknown-sheet value; the application must
-- supply the actual sheet for new imports, not infer an old source value.
ALTER TABLE "vcans_import_rows" ADD COLUMN "sourceSheet" TEXT NOT NULL DEFAULT '';
DROP INDEX "vcans_import_rows_batchId_sourceRow_key";
CREATE UNIQUE INDEX "vcans_import_rows_batchId_sourceSheet_sourceRow_key" ON "vcans_import_rows"("batchId", "sourceSheet", "sourceRow");
