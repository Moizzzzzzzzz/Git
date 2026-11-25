-- Existing orders have no inferred customer; only explicit real references.
ALTER TABLE "vcans_orders" ADD COLUMN "customerId" UUID;
ALTER TABLE "vcans_orders" ADD CONSTRAINT "vcans_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "vcans_orders_customerId_idx" ON "vcans_orders"("customerId");
