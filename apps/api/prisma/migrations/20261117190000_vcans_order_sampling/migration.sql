-- CreateEnum
CREATE TYPE "VcansOrderSource" AS ENUM ('MANUAL', 'VCANS');

-- CreateEnum
CREATE TYPE "VcansPlanMode" AS ENUM ('FULL', 'FIXED_PER_LOT', 'PERCENT_PER_LOT');

-- CreateEnum
CREATE TYPE "VcansSelectionKind" AS ENUM ('ORIGINAL', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "VcansImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "vcans_orders" (
    "supervisorId" UUID,
    "assignedInspectorId" UUID,
    "fourPointStandardId" UUID,
    "templateId" UUID,
    "id" UUID NOT NULL,
    "hNo" TEXT NOT NULL,
    "businessDepartmentId" UUID NOT NULL,
    "taskId" UUID,
    "createdById" UUID NOT NULL,
    "source" "VcansOrderSource" NOT NULL,
    "dueAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "arrivalComplete" BOOLEAN NOT NULL DEFAULT false,
    "arrivalConfirmedById" UUID,
    "arrivalConfirmedAt" TIMESTAMPTZ(3),
    "planMode" "VcansPlanMode" NOT NULL,
    "fixedRolls" INTEGER,
    "percent" DECIMAL(7,4),
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vcans_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "customerOrderNo" TEXT,
    "productName" TEXT,
    "productCode" TEXT,
    "color" TEXT,
    "specification" TEXT,
    "quantity" DECIMAL(18,4),
    "quantityUnit" TEXT,
    "sourceSnapshot" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vcans_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_import_batches" (
    "id" UUID NOT NULL,
    "businessDepartmentId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" "VcansImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vcans_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_import_rows" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "rawSnapshot" JSONB NOT NULL,
    "validation" JSONB,
    "orderLineId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcans_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_order_changes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineId" UUID,
    "actorId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcans_order_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_dye_lots" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "dyeLotNo" TEXT NOT NULL,
    "actualRollCount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vcans_dye_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_order_rolls" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "taskRollId" UUID,
    "nominalLengthM" DECIMAL(10,2),
    "nominalWeightKg" DECIMAL(10,3),
    "measuredLengthM" DECIMAL(10,2),
    "measuredWeightKg" DECIMAL(10,3),
    "nominalSource" TEXT,
    "measuredLengthSource" TEXT,
    "measuredWeightSource" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vcans_order_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_sample_selections" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "orderRollId" UUID NOT NULL,
    "kind" "VcansSelectionKind" NOT NULL,
    "selectedById" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcans_sample_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_report_versions" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "confirmedById" UUID NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcans_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcans_report_files" (
    "id" UUID NOT NULL,
    "reportVersionId" UUID NOT NULL,
    "outputType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcans_report_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vcans_orders_hNo_key" ON "vcans_orders"("hNo");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_orders_taskId_key" ON "vcans_orders"("taskId");

-- CreateIndex
CREATE INDEX "vcans_orders_businessDepartmentId_idx" ON "vcans_orders"("businessDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_order_lines_orderId_lineNo_key" ON "vcans_order_lines"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_order_lines_id_orderId_key" ON "vcans_order_lines"("id", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_import_batches_businessDepartmentId_idempotencyKey_key" ON "vcans_import_batches"("businessDepartmentId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_import_rows_batchId_sourceRow_key" ON "vcans_import_rows"("batchId", "sourceRow");

-- CreateIndex
CREATE INDEX "vcans_order_changes_orderId_createdAt_idx" ON "vcans_order_changes"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_dye_lots_lineId_dyeLotNo_key" ON "vcans_dye_lots"("lineId", "dyeLotNo");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_dye_lots_id_lineId_orderId_key" ON "vcans_dye_lots"("id", "lineId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_order_rolls_rollId_key" ON "vcans_order_rolls"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_order_rolls_taskRollId_key" ON "vcans_order_rolls"("taskRollId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_order_rolls_id_lotId_orderId_key" ON "vcans_order_rolls"("id", "lotId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_sample_selections_orderRollId_kind_key" ON "vcans_sample_selections"("orderRollId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_report_versions_orderId_version_key" ON "vcans_report_versions"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_report_files_reportVersionId_outputType_key" ON "vcans_report_files"("reportVersionId", "outputType");

-- CreateIndex
CREATE UNIQUE INDEX "vcans_report_files_objectKey_key" ON "vcans_report_files"("objectKey");

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_assignedInspectorId_fkey" FOREIGN KEY ("assignedInspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_fourPointStandardId_fkey" FOREIGN KEY ("fourPointStandardId") REFERENCES "quality_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_businessDepartmentId_fkey" FOREIGN KEY ("businessDepartmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_arrivalConfirmedById_fkey" FOREIGN KEY ("arrivalConfirmedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_lines" ADD CONSTRAINT "vcans_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "vcans_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_import_batches" ADD CONSTRAINT "vcans_import_batches_businessDepartmentId_fkey" FOREIGN KEY ("businessDepartmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_import_batches" ADD CONSTRAINT "vcans_import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_import_rows" ADD CONSTRAINT "vcans_import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "vcans_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_import_rows" ADD CONSTRAINT "vcans_import_rows_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "vcans_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_changes" ADD CONSTRAINT "vcans_order_changes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "vcans_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_changes" ADD CONSTRAINT "vcans_order_changes_lineId_orderId_fkey" FOREIGN KEY ("lineId", "orderId") REFERENCES "vcans_order_lines"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_changes" ADD CONSTRAINT "vcans_order_changes_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_dye_lots" ADD CONSTRAINT "vcans_dye_lots_lineId_orderId_fkey" FOREIGN KEY ("lineId", "orderId") REFERENCES "vcans_order_lines"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_dye_lots" ADD CONSTRAINT "vcans_dye_lots_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_order_rolls_lotId_lineId_orderId_fkey" FOREIGN KEY ("lotId", "lineId", "orderId") REFERENCES "vcans_dye_lots"("id", "lineId", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_order_rolls_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_order_rolls_taskRollId_fkey" FOREIGN KEY ("taskRollId") REFERENCES "qc_task_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_selections_orderRollId_lotId_orderId_fkey" FOREIGN KEY ("orderRollId", "lotId", "orderId") REFERENCES "vcans_order_rolls"("id", "lotId", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_selections_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_report_versions" ADD CONSTRAINT "vcans_report_versions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "vcans_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_report_versions" ADD CONSTRAINT "vcans_report_versions_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcans_report_files" ADD CONSTRAINT "vcans_report_files_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "vcans_report_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Additional domain checks; no existing tables or records are changed.
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_plan_check" CHECK (
  ("planMode" = 'FULL' AND "fixedRolls" IS NULL AND "percent" IS NULL) OR
  ("planMode" = 'FIXED_PER_LOT' AND "fixedRolls" IS NOT NULL AND "fixedRolls" > 0 AND "percent" IS NULL) OR
  ("planMode" = 'PERCENT_PER_LOT' AND "percent" IS NOT NULL AND "percent" > 0 AND "percent" <= 100 AND "fixedRolls" IS NULL)
);
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_version_check" CHECK ("version" >= 0);
ALTER TABLE "vcans_order_lines" ADD CONSTRAINT "vcans_lines_valid_check" CHECK ("lineNo" > 0 AND "revision" >= 0 AND ("quantity" IS NULL OR "quantity" >= 0));
ALTER TABLE "vcans_dye_lots" ADD CONSTRAINT "vcans_lots_valid_check" CHECK ("actualRollCount" >= 0 AND "version" >= 0);
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_rolls_valid_check" CHECK (
  "version" >= 0 AND ("nominalLengthM" IS NULL OR "nominalLengthM" >= 0) AND
  ("nominalWeightKg" IS NULL OR "nominalWeightKg" >= 0) AND
  ("measuredLengthM" IS NULL OR "measuredLengthM" >= 0) AND
  ("measuredWeightKg" IS NULL OR "measuredWeightKg" >= 0)
);
ALTER TABLE "vcans_report_versions" ADD CONSTRAINT "vcans_report_version_positive" CHECK ("version" > 0);

-- These rows are append-only under ordinary application access. Privileged DB
-- owners can alter triggers, so deployment privileges must still be restricted.
CREATE FUNCTION vcans_reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VCANS immutable record cannot be changed' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER vcans_report_version_immutable BEFORE UPDATE OR DELETE ON "vcans_report_versions" FOR EACH ROW EXECUTE FUNCTION vcans_reject_immutable_change();
CREATE TRIGGER vcans_report_file_immutable BEFORE UPDATE OR DELETE ON "vcans_report_files" FOR EACH ROW EXECUTE FUNCTION vcans_reject_immutable_change();
CREATE TRIGGER vcans_order_change_immutable BEFORE UPDATE OR DELETE ON "vcans_order_changes" FOR EACH ROW EXECUTE FUNCTION vcans_reject_immutable_change();
CREATE FUNCTION vcans_preserve_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot" THEN
    RAISE EXCEPTION 'VCANS source snapshot cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_line_source_immutable BEFORE UPDATE ON "vcans_order_lines" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_source_snapshot();
CREATE FUNCTION vcans_preserve_import_raw() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."rawSnapshot" IS DISTINCT FROM OLD."rawSnapshot" THEN
    RAISE EXCEPTION 'VCANS raw import row cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_import_raw_immutable BEFORE UPDATE ON "vcans_import_rows" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_import_raw();
CREATE TRIGGER vcans_import_row_no_delete BEFORE DELETE ON "vcans_import_rows" FOR EACH ROW EXECUTE FUNCTION vcans_reject_immutable_change();
