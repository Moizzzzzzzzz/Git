import type {JudgeResult} from '@fabricqc/shared';
export type FinalResult='PASS'|'FAIL';
export interface QualityReviewFields {
 systemResult?:JudgeResult|null;systemReasons?:string[];normalizedScore?:number|null;scoreUnit?:string|null;
 reviewEligibility?:{required:boolean;allowed:boolean;canApprovePass?:boolean;reasons:{code:string;message:string}[]};
 finalResult?:FinalResult|null;finalReason?:string|null;reviewer?:{id:string;name:string}|null;reviewedAt?:string|null;
}
export function qualityReviewInput(fields:QualityReviewFields,decision:string,result:FinalResult|'',reason:string):{finalResult?:FinalResult;finalReason?:string}{
 if(decision!=='APPROVE')return {};
 const e=fields.reviewEligibility;
 if(!e){if(result||reason.trim())throw new Error('当前记录未提供主管复核权限，请刷新后重试');return {};}
 if(e.required&&!e.allowed)throw new Error('当前记录不能完成主管复核，请按提示处理后重试');
 if(!result){if(e.required)throw new Error('请选择主管最终质量结论');return {};}
 if(!e.allowed)throw new Error('当前记录不允许更改质量结论');
 if(result==='PASS'&&e.canApprovePass!==true)throw new Error('当前记录不允许复核为合格，请按原始异常处理');
 if(!reason.trim())throw new Error('请填写主管复核原因');
 if(reason.trim().length>1000)throw new Error('主管复核原因不能超过 1000 字');
 return {finalResult:result,finalReason:reason.trim()};
}
export const finalQualityLabel=(value:FinalResult)=>value==='PASS'?'主管复核合格':'主管复核不合格';
