-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('ADMIN', 'INSPECTOR', 'QC_SUPERVISOR', 'QUALITY_MANAGER', 'SALES');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('ADMIN_WEB', 'MINIAPP');

-- CreateEnum
CREATE TYPE "InspectionMode" AS ENUM ('MACHINE', 'MANUAL');

-- CreateEnum
CREATE TYPE "InspectionScope" AS ENUM ('FULL', 'PARTIAL', 'SAMPLING');

-- CreateEnum
CREATE TYPE "RollStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_INSPECTION', 'SUBMITTED', 'RETURNED', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskRollStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'RETURNED', 'DONE');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "JudgeResult" AS ENUM ('PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "StandardKind" AS ENUM ('FOUR_POINT', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "StandardVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'RETURN', 'REJECT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('CHECKPOINT', 'DEFECT', 'GENERAL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'ENQUEUED', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WECHAT_SUBSCRIBE', 'WECOM');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" UUID,
    "position" TEXT,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "username" TEXT,
    "passwordHash" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "supervisorId" UUID,
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "departmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_identities" (
    "id" UUID NOT NULL,
    "appId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "unionId" TEXT,
    "userId" UUID NOT NULL,
    "boundAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(3),

    CONSTRAINT "wechat_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_bind_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_bind_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientType" "ClientType" NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "previousRefreshTokenHash" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMPTZ(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_orders" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "orderDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "fabricId" UUID NOT NULL,
    "quantityM" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabrics" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "composition" TEXT,
    "widthCm" DECIMAL(8,2),
    "cuttableWidthCm" DECIMAL(8,2),
    "gsm" DECIMAL(8,2),
    "weaveStructure" TEXT,
    "coatingType" TEXT,
    "color" TEXT,
    "colorCode" TEXT,
    "customerId" UUID,
    "defaultFourPointStandardId" UUID,
    "defaultCustomerStandardId" UUID,
    "defaultTemplateId" UUID,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fabrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lots" (
    "id" UUID NOT NULL,
    "fabricId" UUID NOT NULL,
    "lotNo" TEXT NOT NULL,
    "dyeLotNo" TEXT NOT NULL DEFAULT '',
    "colorCode" TEXT,
    "producedAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_rolls" (
    "id" UUID NOT NULL,
    "rollNo" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "fabricId" UUID NOT NULL,
    "lotId" UUID,
    "dyeLotNo" TEXT,
    "colorCode" TEXT,
    "nominalLengthM" DECIMAL(10,2),
    "actualLengthM" DECIMAL(10,2),
    "status" "RollStatus" NOT NULL DEFAULT 'PENDING',
    "orderLineId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fabric_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_standards" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StandardKind" NOT NULL,
    "customerId" UUID,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quality_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_versions" (
    "id" UUID NOT NULL,
    "standardId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StandardVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "notes" TEXT,
    "isDevDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "publishedById" UUID,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "standard_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT,
    "category" TEXT,
    "defaultSeverity" "DefectSeverity" NOT NULL DEFAULT 'MINOR',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "defect_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_tasks" (
    "id" UUID NOT NULL,
    "taskNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" UUID,
    "customerId" UUID,
    "assigneeId" UUID NOT NULL,
    "reviewerId" UUID,
    "defaultMode" "InspectionMode",
    "defaultScope" "InspectionScope" NOT NULL DEFAULT 'FULL',
    "fourPointStandardId" UUID NOT NULL,
    "customerStandardId" UUID,
    "templateId" UUID NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qc_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_task_rolls" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "status" "TaskRollStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qc_task_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_inspections" (
    "id" UUID NOT NULL,
    "inspectionNo" TEXT NOT NULL,
    "taskId" UUID NOT NULL,
    "taskRollId" UUID NOT NULL,
    "rollId" UUID NOT NULL,
    "inspectorId" UUID NOT NULL,
    "mode" "InspectionMode" NOT NULL,
    "scope" "InspectionScope" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draftVersion" INTEGER NOT NULL DEFAULT 0,
    "previousInspectionId" UUID,
    "fourPointVersionId" UUID NOT NULL,
    "customerVersionId" UUID,
    "standardSnapshot" JSONB NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "specSnapshot" JSONB NOT NULL,
    "checklistResults" JSONB NOT NULL DEFAULT '[]',
    "resultSnapshot" JSONB,
    "fourPointResult" "JudgeResult",
    "customerResult" "JudgeResult",
    "overallResult" "JudgeResult",
    "totalPoints" DECIMAL(10,3),
    "normalizedPoints" DECIMAL(10,2),
    "inspectedLengthM" DECIMAL(10,3),
    "actualLengthM" DECIMAL(10,2),
    "widthUsedCm" DECIMAL(8,3),
    "remarks" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roll_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_revisions" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_segments" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "startM" DECIMAL(10,3) NOT NULL,
    "endM" DECIMAL(10,3) NOT NULL,

    CONSTRAINT "inspection_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "itemKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "value" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "positionM" DECIMAL(10,3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defects" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "defectTypeCode" TEXT NOT NULL,
    "lengthCm" DECIMAL(10,2) NOT NULL,
    "widthCm" DECIMAL(10,2),
    "positionM" DECIMAL(10,3) NOT NULL,
    "widthPositionCm" DECIMAL(10,2),
    "severity" "DefectSeverity" NOT NULL,
    "points" DECIMAL(8,2),
    "remark" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "inspectionId" UUID,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_links" (
    "id" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "checkpointKey" TEXT,
    "defectClientId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reviews" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "isConcession" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_assignments" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "assigneeId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "pagePath" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enqueuedAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "outboxId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "templateId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "templateId" TEXT NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "lastAcceptedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wechat_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeNo_key" ON "users"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_departmentId_idx" ON "users"("departmentId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_departmentId_key" ON "user_roles"("userId", "roleId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_identities_appId_openId_key" ON "wechat_identities"("appId", "openId");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_identities_appId_userId_key" ON "wechat_identities"("appId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_bind_codes_codeHash_key" ON "wechat_bind_codes"("codeHash");

-- CreateIndex
CREATE INDEX "wechat_bind_codes_userId_idx" ON "wechat_bind_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_refreshTokenHash_key" ON "auth_sessions"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_previousRefreshTokenHash_key" ON "auth_sessions"("previousRefreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_revokedAt_idx" ON "auth_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_orders_orderNo_key" ON "customer_orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_lines_orderId_lineNo_key" ON "customer_order_lines"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "fabrics_code_key" ON "fabrics"("code");

-- CreateIndex
CREATE INDEX "fabrics_customerId_idx" ON "fabrics"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "production_lots_fabricId_lotNo_dyeLotNo_key" ON "production_lots"("fabricId", "lotNo", "dyeLotNo");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_rollNo_key" ON "fabric_rolls"("rollNo");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_qrCode_key" ON "fabric_rolls"("qrCode");

-- CreateIndex
CREATE INDEX "fabric_rolls_fabricId_idx" ON "fabric_rolls"("fabricId");

-- CreateIndex
CREATE INDEX "fabric_rolls_lotId_idx" ON "fabric_rolls"("lotId");

-- CreateIndex
CREATE INDEX "fabric_rolls_status_idx" ON "fabric_rolls"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quality_standards_code_key" ON "quality_standards"("code");

-- CreateIndex
CREATE INDEX "standard_versions_standardId_status_idx" ON "standard_versions"("standardId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "standard_versions_standardId_version_key" ON "standard_versions"("standardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_templates_code_key" ON "inspection_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "defect_types_code_key" ON "defect_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "qc_tasks_taskNo_key" ON "qc_tasks"("taskNo");

-- CreateIndex
CREATE INDEX "qc_tasks_assigneeId_status_idx" ON "qc_tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "qc_tasks_status_idx" ON "qc_tasks"("status");

-- CreateIndex
CREATE INDEX "qc_task_rolls_rollId_idx" ON "qc_task_rolls"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_task_rolls_taskId_rollId_key" ON "qc_task_rolls"("taskId", "rollId");

-- CreateIndex
CREATE UNIQUE INDEX "roll_inspections_inspectionNo_key" ON "roll_inspections"("inspectionNo");

-- CreateIndex
CREATE UNIQUE INDEX "roll_inspections_previousInspectionId_key" ON "roll_inspections"("previousInspectionId");

-- CreateIndex
CREATE INDEX "roll_inspections_rollId_idx" ON "roll_inspections"("rollId");

-- CreateIndex
CREATE INDEX "roll_inspections_taskRollId_idx" ON "roll_inspections"("taskRollId");

-- CreateIndex
CREATE INDEX "roll_inspections_inspectorId_status_idx" ON "roll_inspections"("inspectorId", "status");

-- CreateIndex
CREATE INDEX "roll_inspections_status_submittedAt_idx" ON "roll_inspections"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_revisions_idempotencyKey_key" ON "inspection_revisions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_revisions_inspectionId_revision_key" ON "inspection_revisions"("inspectionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_segments_inspectionId_seq_key" ON "inspection_segments"("inspectionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_inspectionId_itemKey_seq_key" ON "measurements"("inspectionId", "itemKey", "seq");

-- CreateIndex
CREATE INDEX "defects_defectTypeCode_idx" ON "defects"("defectTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "defects_inspectionId_clientId_key" ON "defects"("inspectionId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_objectKey_key" ON "media_assets"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_thumbKey_key" ON "media_assets"("thumbKey");

-- CreateIndex
CREATE INDEX "media_assets_inspectionId_idx" ON "media_assets"("inspectionId");

-- CreateIndex
CREATE INDEX "media_links_inspectionId_idx" ON "media_links"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "media_links_mediaId_inspectionId_key" ON "media_links"("mediaId", "inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_reviews_inspectionId_revision_key" ON "qc_reviews"("inspectionId", "revision");

-- CreateIndex
CREATE INDEX "review_assignments_assigneeId_status_idx" ON "review_assignments"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_assignments_inspectionId_revision_assigneeId_key" ON "review_assignments"("inspectionId", "revision", "assigneeId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupeKey_key" ON "notification_outbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_outbox_status_availableAt_idx" ON "notification_outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_outboxId_idx" ON "notification_deliveries"("outboxId");

-- CreateIndex
CREATE INDEX "notification_deliveries_userId_idx" ON "notification_deliveries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_subscriptions_userId_templateId_key" ON "wechat_subscriptions"("userId", "templateId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wechat_identities" ADD CONSTRAINT "wechat_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wechat_bind_codes" ADD CONSTRAINT "wechat_bind_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "fabrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabrics" ADD CONSTRAINT "fabrics_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabrics" ADD CONSTRAINT "fabrics_defaultFourPointStandardId_fkey" FOREIGN KEY ("defaultFourPointStandardId") REFERENCES "quality_standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabrics" ADD CONSTRAINT "fabrics_defaultCustomerStandardId_fkey" FOREIGN KEY ("defaultCustomerStandardId") REFERENCES "quality_standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabrics" ADD CONSTRAINT "fabrics_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "inspection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lots" ADD CONSTRAINT "production_lots_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "fabrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_fabricId_fkey" FOREIGN KEY ("fabricId") REFERENCES "fabrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "production_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "customer_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_standards" ADD CONSTRAINT "quality_standards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_versions" ADD CONSTRAINT "standard_versions_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "quality_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_fourPointStandardId_fkey" FOREIGN KEY ("fourPointStandardId") REFERENCES "quality_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_customerStandardId_fkey" FOREIGN KEY ("customerStandardId") REFERENCES "quality_standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_rolls" ADD CONSTRAINT "qc_task_rolls_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_rolls" ADD CONSTRAINT "qc_task_rolls_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_taskRollId_fkey" FOREIGN KEY ("taskRollId") REFERENCES "qc_task_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_previousInspectionId_fkey" FOREIGN KEY ("previousInspectionId") REFERENCES "roll_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_fourPointVersionId_fkey" FOREIGN KEY ("fourPointVersionId") REFERENCES "standard_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_inspections" ADD CONSTRAINT "roll_inspections_customerVersionId_fkey" FOREIGN KEY ("customerVersionId") REFERENCES "standard_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_revisions" ADD CONSTRAINT "inspection_revisions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_segments" ADD CONSTRAINT "inspection_segments_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defects" ADD CONSTRAINT "defects_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_links" ADD CONSTRAINT "media_links_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "roll_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "notification_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wechat_subscriptions" ADD CONSTRAINT "wechat_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
