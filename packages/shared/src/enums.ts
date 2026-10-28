/**
 * 业务枚举。值必须与 apps/api/prisma/schema.prisma 中的 enum 保持一致。
 * 使用 const 对象而不是 TS enum，便于在小程序和前端 tree-shaking。
 */

function values<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]];
}

export const RoleCode = {
  ADMIN: 'ADMIN',
  INSPECTOR: 'INSPECTOR',
  QC_SUPERVISOR: 'QC_SUPERVISOR',
  QUALITY_MANAGER: 'QUALITY_MANAGER',
  SALES: 'SALES',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];
export const ROLE_CODES = values(RoleCode);

export const UserStatus = { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = values(UserStatus);

export const ClientType = { ADMIN_WEB: 'ADMIN_WEB', MINIAPP: 'MINIAPP' } as const;
export type ClientType = (typeof ClientType)[keyof typeof ClientType];

export const InspectionMode = { MACHINE: 'MACHINE', MANUAL: 'MANUAL' } as const;
export type InspectionMode = (typeof InspectionMode)[keyof typeof InspectionMode];
export const INSPECTION_MODES = values(InspectionMode);

export const InspectionScope = { FULL: 'FULL', PARTIAL: 'PARTIAL', SAMPLING: 'SAMPLING' } as const;
export type InspectionScope = (typeof InspectionScope)[keyof typeof InspectionScope];
export const INSPECTION_SCOPES = values(InspectionScope);

export const RollStatus = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  IN_INSPECTION: 'IN_INSPECTION',
  SUBMITTED: 'SUBMITTED',
  RETURNED: 'RETURNED',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
} as const;
export type RollStatus = (typeof RollStatus)[keyof typeof RollStatus];
export const ROLL_STATUSES = values(RollStatus);

export const TaskStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = values(TaskStatus);

export const TaskRollStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  RETURNED: 'RETURNED',
  DONE: 'DONE',
} as const;
export type TaskRollStatus = (typeof TaskRollStatus)[keyof typeof TaskRollStatus];

export const InspectionStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  RETURNED: 'RETURNED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  VOIDED: 'VOIDED',
} as const;
export type InspectionStatus = (typeof InspectionStatus)[keyof typeof InspectionStatus];
export const INSPECTION_STATUSES = values(InspectionStatus);

export const JudgeResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type JudgeResult = (typeof JudgeResult)[keyof typeof JudgeResult];

export const StandardKind = { FOUR_POINT: 'FOUR_POINT', CUSTOMER: 'CUSTOMER' } as const;
export type StandardKind = (typeof StandardKind)[keyof typeof StandardKind];
export const STANDARD_KINDS = values(StandardKind);

export const StandardVersionStatus = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED', RETIRED: 'RETIRED' } as const;
export type StandardVersionStatus = (typeof StandardVersionStatus)[keyof typeof StandardVersionStatus];

export const DefectSeverity = { MINOR: 'MINOR', MAJOR: 'MAJOR', CRITICAL: 'CRITICAL' } as const;
export type DefectSeverity = (typeof DefectSeverity)[keyof typeof DefectSeverity];
export const DEFECT_SEVERITIES = values(DefectSeverity);
export const SEVERITY_RANK: Record<DefectSeverity, number> = { MINOR: 1, MAJOR: 2, CRITICAL: 3 };

export const ReviewDecision = { APPROVE: 'APPROVE', RETURN: 'RETURN', REJECT: 'REJECT' } as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];
export const REVIEW_DECISIONS = values(ReviewDecision);

export const MediaKind = { CHECKPOINT: 'CHECKPOINT', DEFECT: 'DEFECT', GENERAL: 'GENERAL' } as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];
export const MEDIA_KINDS = values(MediaKind);

export const MediaStatus = { PENDING: 'PENDING', UPLOADED: 'UPLOADED', FAILED: 'FAILED' } as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];

export const ChecklistStatus = { OK: 'OK', NG: 'NG', NA: 'NA' } as const;
export type ChecklistStatus = (typeof ChecklistStatus)[keyof typeof ChecklistStatus];
export const CHECKLIST_STATUSES = values(ChecklistStatus);
