import type {
  DefectSeverity,
  InspectionMode,
  InspectionScope,
  InspectionStatus,
  JudgeResult,
  ReviewDecision,
  RoleCode,
  RollStatus,
  TaskStatus,
  UserStatus,
} from './enums';

/** 界面中文标签（PC 后台与小程序共用） */
export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: '系统管理员',
  INSPECTOR: '质检员',
  QC_SUPERVISOR: '质检主管',
  QUALITY_MANAGER: '质量经理',
  SALES: '业务员',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = { ACTIVE: '启用', DISABLED: '停用' };

export const MODE_LABELS: Record<InspectionMode, string> = { MACHINE: '验布机', MANUAL: '人工验布' };

export const SCOPE_LABELS: Record<InspectionScope, string> = {
  FULL: '整卷全检',
  PARTIAL: '部分检验',
  SAMPLING: '抽检',
};

export const ROLL_STATUS_LABELS: Record<RollStatus, string> = {
  PENDING: '待分配',
  ASSIGNED: '已分配',
  IN_INSPECTION: '检验中',
  SUBMITTED: '待审核',
  RETURNED: '已退回',
  PASSED: '合格',
  FAILED: '不合格',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: '待开始',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待审核',
  RETURNED: '已退回',
  APPROVED: '审核通过',
  REJECTED: '判定不合格',
  VOIDED: '已作废',
};

export const JUDGE_LABELS: Record<JudgeResult, string> = {
  PASS: '合格',
  FAIL: '不合格',
  INCONCLUSIVE: '无法判定',
  NOT_APPLICABLE: '不适用',
};

export const SEVERITY_LABELS: Record<DefectSeverity, string> = {
  MINOR: '轻微',
  MAJOR: '严重',
  CRITICAL: '致命',
};

export const DECISION_LABELS: Record<ReviewDecision, string> = {
  APPROVE: '通过',
  RETURN: '退回修改',
  REJECT: '判定不合格',
};
