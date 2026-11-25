import type { RoleCode, JudgeResult, TemplateContent } from '@fabricqc/shared';
export const BUSINESS_ROLES: RoleCode[] = ['SALES', 'BUSINESS_MANAGER', 'BUSINESS_CLERK'];
export const QC_ROLES: RoleCode[] = ['ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'INSPECTOR'];
export function isBusinessOnly(roles: RoleCode[]) { return roles.some(r => BUSINESS_ROLES.includes(r)) && !roles.some(r => QC_ROLES.includes(r)); }
export function homePathForRoles(roles: RoleCode[]): '/' | '/orders' | '/tasks' {
  if (roles.some(r => r === 'ADMIN' || r === 'QUALITY_MANAGER' || r === 'QC_SUPERVISOR')) return '/';
  if (roles.some(r => BUSINESS_ROLES.includes(r))) return '/orders';
  return '/tasks';
}
export interface BusinessProgress { createdById: string; id: string; taskNo: string; title: string; businessDepartmentId: string; plannedRollCount: number; assigned: boolean; supervisorId: string; delivered: boolean; planned: number; registered: number; inspected: number; uninspected: number; pendingReview: number; reviewed: number; returned: number; canRemind?:boolean; status?:string }
export function canRemindTask(t: Pick<BusinessProgress, 'delivered'> & Partial<BusinessProgress>) { return !t.delivered && t.status !== 'CANCELLED' && t.canRemind === true; }
export function parseRollNumbers(value: string) { const rolls = value.split(/[\n,，]+/).map(x => x.trim()).filter(Boolean); if (!rolls.length) throw new Error('请填写卷号，每行一个'); if (new Set(rolls).size !== rolls.length) throw new Error('卷号重复，请核对后再提交'); return rolls; }
export interface BusinessOptions { departments: {id:string;name:string}[]; supervisors: {id:string;name:string}[]; standards:{id:string;name:string;code:string;currentVersion?:{isDevDefault?:boolean}|null}[]; templates:{id:string;name:string;code:string}[]; fabrics:{id:string;code:string;nameZh:string}[] }
export interface Delivery { id:string; taskId:string; confirmedAt:string; task:{taskNo:string;title:string;plannedRollCount:number}; items:DeliveryItem[] }
export interface DeliveryItem {
 roll:{id?:string;rollNo:string;fabric?:{code:string;nameZh:string};nominalLengthM?:number|null}; inspector:{name:string}; template?:TemplateContent;
 spec?: Record<string,string|number|null>; standards?: {fourPoint?:{name:string;version:number};customer?:{name:string;version:number}|null}; overallResult:JudgeResult|null; review:{decision:string;comment:string|null;isConcession:boolean};
 inspection:{segments?:{startM:number;endM:number}[];revision?:number;remarks?:string|null;actualLengthM?:number|null;measurements?:{itemKey:string;value:number;unit:string}[];checklist?:{key:string;status:string;note?:string|null}[];defects?:{clientId:string;defectTypeCode:string;positionM:number;lengthCm:number;widthCm?:number|null;points?:number|null;remark?:string|null}[];photos:{mediaId:string;kind:string;checkpointKey:string|null;defectClientId:string|null;url:string;thumbUrl:string|null}[];evaluation?:{warnings?:string[];customer?:{name:string;checks:{code:string;message:string}[]}|null;inspectedLengthM:number;fourPoint:{name:string;scoring:{normalizedPoints:number|null;totalPoints:number;areaUnit?:string|null};checks:{code:string;message:string}[]};overall:{result:JudgeResult;reasons:string[]}}};
}
