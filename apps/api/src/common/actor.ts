import { RoleCode, type ClientType } from '@fabricqc/shared';

export interface ActorRole {
  role: RoleCode;
  departmentId: string | null;
}

/**
 * 当前操作主体。只能由服务端根据会话从数据库构造，绝不接受客户端传入的角色或用户 ID。
 * 业务 Service 以 Actor 为参数做权限校验，未来 MCP 入口复用同一套校验。
 */
export interface Actor {
  userId: string;
  name: string;
  employeeNo: string;
  departmentId: string | null;
  roles: ActorRole[];
  sessionId: string;
  clientType: ClientType | 'SYSTEM';
}

export function hasRole(actor: Actor, ...roles: RoleCode[]): boolean {
  return actor.roles.some((r) => roles.includes(r.role));
}

/** 角色在指定部门范围内是否有效（全厂范围的角色对所有部门有效） */
export function hasRoleInDepartment(actor: Actor, role: RoleCode, departmentId: string | null): boolean {
  return actor.roles.some((r) => r.role === role && (r.departmentId === null || r.departmentId === departmentId));
}

export const MANAGE_MASTER_DATA: RoleCode[] = [
  RoleCode.ADMIN,
  RoleCode.QUALITY_MANAGER,
  RoleCode.QC_SUPERVISOR,
  RoleCode.SALES,
];
export const MANAGE_STANDARDS: RoleCode[] = [RoleCode.ADMIN, RoleCode.QUALITY_MANAGER];
export const MANAGE_TASKS: RoleCode[] = [RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR];
export const REVIEWERS: RoleCode[] = [RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR];
export const VIEW_QC_RECORDS: RoleCode[] = [
  RoleCode.ADMIN,
  RoleCode.QUALITY_MANAGER,
  RoleCode.QC_SUPERVISOR,
  RoleCode.SALES,
];
