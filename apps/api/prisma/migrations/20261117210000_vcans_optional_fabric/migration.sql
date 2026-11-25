-- Existing rows are not rewritten. Only a VCANS-linked roll may lack fabric.
ALTER TABLE "fabric_rolls" ALTER COLUMN "fabricId" DROP NOT NULL;

-- At deferred check time lock the roll first. This serializes a concurrent
-- unlink and change to a missing fabric and prevents both from passing based
-- on stale observations. The API must still enforce authorization, ownership,
-- and that legacy creation endpoints keep requiring a real fabric.
CREATE FUNCTION vcans_check_roll_fabric_link(p_roll_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE is_missing BOOLEAN;
BEGIN
  SELECT "fabricId" IS NULL INTO is_missing FROM "fabric_rolls" WHERE id = p_roll_id FOR UPDATE;
  IF FOUND AND is_missing AND NOT EXISTS (SELECT 1 FROM "vcans_order_rolls" WHERE "rollId" = p_roll_id) THEN
    RAISE EXCEPTION 'A roll without fabric must be linked to a VCANS order roll' USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE FUNCTION vcans_check_roll_fabric_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vcans_check_roll_fabric_link(NEW.id);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER vcans_roll_fabric_requires_link
AFTER INSERT OR UPDATE OF "fabricId" ON "fabric_rolls"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vcans_check_roll_fabric_event();

CREATE FUNCTION vcans_check_unlinked_roll_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM vcans_check_roll_fabric_link(OLD."rollId");
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER vcans_unlink_requires_fabric
AFTER DELETE OR UPDATE OF "rollId" ON "vcans_order_rolls"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vcans_check_unlinked_roll_event();
