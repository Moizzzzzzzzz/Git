-- Anonymous customer bearer: store only a hash and its bound, sanitized view.
CREATE TABLE "vcans_report_shares" (
  "id" UUID NOT NULL,
  "reportVersionId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "issuedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedById" UUID,
  "frozenView" JSONB NOT NULL,
  "privatePhotoRefs" JSONB NOT NULL,
  CONSTRAINT "vcans_report_shares_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vcans_share_token_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "vcans_share_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "vcans_share_revocation_pair_check" CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND "revokedAt" >= "createdAt"))
);
CREATE UNIQUE INDEX "vcans_report_shares_tokenHash_key" ON "vcans_report_shares"("tokenHash");
CREATE INDEX "vcans_report_shares_reportVersionId_createdAt_idx" ON "vcans_report_shares"("reportVersionId", "createdAt");
CREATE INDEX "vcans_report_shares_issuedById_createdAt_idx" ON "vcans_report_shares"("issuedById", "createdAt");
CREATE INDEX "vcans_report_shares_expiresAt_idx" ON "vcans_report_shares"("expiresAt");
ALTER TABLE "vcans_report_shares" ADD CONSTRAINT "vcans_report_shares_reportVersionId_fkey" FOREIGN KEY ("reportVersionId") REFERENCES "vcans_report_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_report_shares" ADD CONSTRAINT "vcans_report_shares_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_report_shares" ADD CONSTRAINT "vcans_report_shares_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION vcans_preserve_report_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."reportVersionId" IS DISTINCT FROM OLD."reportVersionId" OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash" OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."frozenView" IS DISTINCT FROM OLD."frozenView" OR NEW."privatePhotoRefs" IS DISTINCT FROM OLD."privatePhotoRefs" OR (OLD."revokedAt" IS NOT NULL AND (NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" OR NEW."revokedById" IS DISTINCT FROM OLD."revokedById")) THEN
  RAISE EXCEPTION 'share fields and revocation are immutable' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER vcans_report_share_immutable BEFORE UPDATE ON "vcans_report_shares" FOR EACH ROW EXECUTE FUNCTION vcans_preserve_report_share();
