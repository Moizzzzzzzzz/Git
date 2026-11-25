-- Historical measurements retain unknown time and actor; do not infer values.
ALTER TABLE "vcans_order_rolls" ADD COLUMN "measuredLengthAt" TIMESTAMPTZ(3), ADD COLUMN "measuredWeightAt" TIMESTAMPTZ(3), ADD COLUMN "measuredLengthById" UUID, ADD COLUMN "measuredWeightById" UUID;
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_roll_measured_length_actor_fkey" FOREIGN KEY ("measuredLengthById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vcans_order_rolls" ADD CONSTRAINT "vcans_roll_measured_weight_actor_fkey" FOREIGN KEY ("measuredWeightById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
