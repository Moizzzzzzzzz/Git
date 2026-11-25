-- CreateEnum
CREATE TYPE "TaskOrigin" AS ENUM ('LEGACY', 'BUSINESS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RoleCode" ADD VALUE 'BUSINESS_MANAGER';
ALTER TYPE "RoleCode" ADD VALUE 'BUSINESS_CLERK';

-- AlterTable
ALTER TABLE "qc_tasks" ADD COLUMN     "businessDepartmentId" UUID,
ADD COLUMN     "origin" "TaskOrigin" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "plannedRollCount" INTEGER,
ADD COLUMN     "supervisorId" UUID,
ALTER COLUMN "assigneeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "qc_task_assignment_events" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromAssigneeId" UUID,
    "toAssigneeId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "qc_task_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_task_deliveries" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "confirmedById" UUID NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedRollCount" INTEGER NOT NULL,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "qc_task_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_task_delivery_items" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "taskRollId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "inspectionRevisionId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "qc_task_delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_review_reminders" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "supervisorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,
    "notificationId" UUID,

    CONSTRAINT "qc_review_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qc_task_assignment_events_taskId_createdAt_idx" ON "qc_task_assignment_events"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_task_deliveries_taskId_key" ON "qc_task_deliveries"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_task_delivery_items_deliveryId_taskRollId_key" ON "qc_task_delivery_items"("deliveryId", "taskRollId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_task_delivery_items_deliveryId_rollId_key" ON "qc_task_delivery_items"("deliveryId", "rollId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_review_reminders_dedupeKey_key" ON "qc_review_reminders"("dedupeKey");

-- CreateIndex
CREATE INDEX "qc_review_reminders_taskId_createdAt_idx" ON "qc_review_reminders"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_tasks_businessDepartmentId_status_idx" ON "qc_tasks"("businessDepartmentId", "status");

-- CreateIndex
CREATE INDEX "qc_tasks_supervisorId_status_idx" ON "qc_tasks"("supervisorId", "status");

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_businessDepartmentId_fkey" FOREIGN KEY ("businessDepartmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_assignment_events" ADD CONSTRAINT "qc_task_assignment_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_assignment_events" ADD CONSTRAINT "qc_task_assignment_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_assignment_events" ADD CONSTRAINT "qc_task_assignment_events_fromAssigneeId_fkey" FOREIGN KEY ("fromAssigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_assignment_events" ADD CONSTRAINT "qc_task_assignment_events_toAssigneeId_fkey" FOREIGN KEY ("toAssigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_deliveries" ADD CONSTRAINT "qc_task_deliveries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_deliveries" ADD CONSTRAINT "qc_task_deliveries_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "qc_task_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_taskRollId_fkey" FOREIGN KEY ("taskRollId") REFERENCES "qc_task_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_inspectionRevisionId_fkey" FOREIGN KEY ("inspectionRevisionId") REFERENCES "inspection_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reminders" ADD CONSTRAINT "qc_review_reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reminders" ADD CONSTRAINT "qc_review_reminders_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reminders" ADD CONSTRAINT "qc_review_reminders_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_review_reminders" ADD CONSTRAINT "qc_review_reminders_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Business tasks require a known business department, supervisor and positive plan.
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_business_required_check" CHECK (
  "origin" <> 'BUSINESS' OR ("businessDepartmentId" IS NOT NULL AND "supervisorId" IS NOT NULL AND "plannedRollCount" IS NOT NULL AND "plannedRollCount" > 0)
);
ALTER TABLE "qc_task_deliveries" ADD CONSTRAINT "qc_task_deliveries_positive_check" CHECK ("plannedRollCount" > 0 AND "snapshotVersion" > 0);
ALTER TABLE "qc_task_delivery_items" ADD CONSTRAINT "qc_task_delivery_items_revision_check" CHECK ("revision" > 0);
