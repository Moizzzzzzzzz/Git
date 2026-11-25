-- Preserve old selections with unknown historical associations as NULL.
CREATE TABLE "vcans_additional_requests" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "result" JSONB, "actorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vcans_additional_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vcans_additional_request_nonempty" CHECK (length("requestKey") > 0 AND length("requestHash") > 0)
);
CREATE UNIQUE INDEX "vcans_additional_requests_orderId_requestKey_key" ON "vcans_additional_requests"("orderId", "requestKey");
CREATE UNIQUE INDEX "vcans_additional_requests_id_orderId_key" ON "vcans_additional_requests"("id", "orderId");
ALTER TABLE "vcans_additional_requests" ADD CONSTRAINT "vcans_additional_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "vcans_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_additional_requests" ADD CONSTRAINT "vcans_additional_requests_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_sample_selections" ADD COLUMN "requestId" UUID, ADD COLUMN "inspectionId" UUID, ADD COLUMN "basisInspectionId" UUID, ADD COLUMN "basisRevisionId" UUID;
DROP INDEX "vcans_sample_selections_orderRollId_kind_key";
CREATE UNIQUE INDEX "vcans_sample_original_roll_key" ON "vcans_sample_selections"("orderRollId") WHERE "kind" = 'ORIGINAL';
CREATE INDEX "vcans_sample_selections_orderRollId_kind_idx" ON "vcans_sample_selections"("orderRollId", "kind");
CREATE UNIQUE INDEX "vcans_sample_selections_inspectionId_key" ON "vcans_sample_selections"("inspectionId");
CREATE UNIQUE INDEX "vcans_sample_selections_requestId_orderRollId_key" ON "vcans_sample_selections"("requestId", "orderRollId");
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_request_order_fkey" FOREIGN KEY ("requestId", "orderId") REFERENCES "vcans_additional_requests"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_inspection_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_basis_inspection_fkey" FOREIGN KEY ("basisInspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_basis_revision_fkey" FOREIGN KEY ("basisRevisionId") REFERENCES "inspection_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- NOT VALID retains pre-existing ADDITIONAL rows without a requestId; new or
-- updated rows must conform. API must not invent links for legacy records.
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_request_kind_check" CHECK (("kind" = 'ORIGINAL' AND "requestId" IS NULL) OR ("kind" = 'ADDITIONAL' AND "requestId" IS NOT NULL)) NOT VALID;
ALTER TABLE "vcans_sample_selections" ADD CONSTRAINT "vcans_sample_basis_pair_check" CHECK (("basisInspectionId" IS NULL AND "basisRevisionId" IS NULL) OR ("kind" = 'ORIGINAL' AND "basisInspectionId" IS NOT NULL AND "basisRevisionId" IS NOT NULL));
-- Request can be created first and completed in the same transaction; incomplete
-- results cannot commit. Request contents/results are immutable once complete.
CREATE FUNCTION vcans_check_additional_request_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "vcans_additional_requests" WHERE id=NEW.id AND "result" IS NULL) THEN
  RAISE EXCEPTION 'additional request result must be saved before commit' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER vcans_additional_request_complete AFTER INSERT OR UPDATE ON "vcans_additional_requests" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vcans_check_additional_request_complete();
CREATE FUNCTION vcans_preserve_additional_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey" OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash" OR NEW."actorId" IS DISTINCT FROM OLD."actorId" OR (OLD."result" IS NOT NULL AND NEW."result" IS DISTINCT FROM OLD."result") THEN
  RAISE EXCEPTION 'additional request is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_additional_request_immutable BEFORE UPDATE OR DELETE ON "vcans_additional_requests" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_additional_request();
CREATE FUNCTION vcans_preserve_selection_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."basisInspectionId" IS NOT NULL OR OLD."kind"='ADDITIONAL' THEN RAISE EXCEPTION 'confirmed basis or additional event cannot be deleted' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF OLD."kind" = 'ADDITIONAL' AND (NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."lotId" IS DISTINCT FROM OLD."lotId" OR NEW."orderRollId" IS DISTINCT FROM OLD."orderRollId" OR NEW."selectedById" IS DISTINCT FROM OLD."selectedById" OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR (OLD."requestId" IS NOT NULL AND NEW."requestId" IS DISTINCT FROM OLD."requestId")) THEN
  RAISE EXCEPTION 'additional event details are immutable' USING ERRCODE='55000';
 END IF;
 IF OLD."kind" = 'ORIGINAL' AND (OLD."inspectionId" IS NOT NULL OR OLD."basisInspectionId" IS NOT NULL) AND (NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."orderId" IS DISTINCT FROM OLD."orderId" OR NEW."lotId" IS DISTINCT FROM OLD."lotId" OR NEW."orderRollId" IS DISTINCT FROM OLD."orderRollId" OR NEW."selectedById" IS DISTINCT FROM OLD."selectedById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt") THEN
  RAISE EXCEPTION 'bound original selection identity is immutable' USING ERRCODE='55000';
 END IF;
 IF (OLD."inspectionId" IS NOT NULL AND NEW."inspectionId" IS DISTINCT FROM OLD."inspectionId") OR (OLD."basisInspectionId" IS NOT NULL AND (NEW."basisInspectionId" IS DISTINCT FROM OLD."basisInspectionId" OR NEW."basisRevisionId" IS DISTINCT FROM OLD."basisRevisionId")) THEN
  RAISE EXCEPTION 'inspection association or approved original basis is immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_sample_basis_immutable BEFORE UPDATE OR DELETE ON "vcans_sample_selections" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_selection_basis();
