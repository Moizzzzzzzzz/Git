import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';

/** 业务接口仅采用明确授权的部门，不从其它岗位继承全厂范围。 */
export function businessDepartments(actor: Actor): string[] {
  const allowed: RoleCode[] = [RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK];
  return [...new Set(actor.roles.filter((r) => allowed.includes(r.role) && r.departmentId !== null).map((r) => r.departmentId as string))];
}

export function hasBusinessRole(actor: Actor): boolean {
  return actor.roles.some((r) => [RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK].some((role) => role === r.role));
}
