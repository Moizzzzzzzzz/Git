import type {RoleCode} from '@fabricqc/shared';
/** UI routing only; the service still authorizes the actual record operation. */
export function taskRollAction(roles:readonly RoleCode[],userId:string|undefined,assigneeId:string|null|undefined,inspectionId:string|null|undefined):'review'|'inspect'|'none'{
 if(inspectionId&&roles.some(r=>r==='QC_SUPERVISOR'||r==='QUALITY_MANAGER')&&userId!==assigneeId)return 'review';
 if(roles.includes('INSPECTOR')&&(!assigneeId||userId===assigneeId))return 'inspect';
 return 'none';
}
