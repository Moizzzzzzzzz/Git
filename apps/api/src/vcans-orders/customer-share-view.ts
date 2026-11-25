import { z } from 'zod';
import { AppError } from '../common/app-error';

const numeric = z.union([z.number().finite(), z.string()]).nullable().optional();
const text = z.string().nullable().optional();
const defect = z.object({ clientId: text, defectTypeCode: text, positionM: numeric, lengthCm: numeric, widthCm: numeric, points: numeric });
const photo = z.object({ kind: text, defectClientId: text, objectKey: text });
const inspection = z.object({ defects: z.array(defect).default([]), photos: z.array(photo).default([]) });
const event = z.object({ inspectionId: text, result: text, systemResult: text, finalResult: text, finalReason: text, submittedAt: text, reviewedAt: text, totalPoints: numeric, normalizedScore: numeric, resultSnapshot: z.object({ fourPoint: z.object({ scoring: z.object({ areaUnit: text, defectScores: z.array(z.object({clientId: z.string(), effectivePoints: numeric})).optional() }).optional() }).optional() }).nullable().optional(), inspection: inspection.nullable().optional() });
const source = z.object({
 hNo: z.string(), version: z.number().int(), confirmedAt: z.string(), originalRequiredRolls: z.number(), standardName: text,
 plan: z.object({mode: z.string(), fixedRolls: numeric, percent: numeric}), defectNames: z.record(z.string()).default({}),
 lines: z.array(z.object({id:z.string(),customerOrderNo:text,productName:text,specification:text,color:text,quantity:numeric,quantityUnit:text})).min(1),
 rolls: z.array(z.object({lineId:z.string(),lotNo:z.string(),rollNo:z.string(),originalSample:z.boolean(),additionalSample:z.boolean().optional(),pendingAdditional:z.boolean().optional(),result:z.string(),nominalLengthM:numeric,nominalWeightKg:numeric,measuredLengthM:numeric,measuredWeightKg:numeric,basisHistory:event.nullable().optional(),additionalHistory:z.array(event).optional()})).min(1),
});
const unit = (value?: string | null) => value === 'PER_100_LINEAR_YD' ? '分/100线码' : value === 'PER_100_SQ_YD' ? '分/100平方码' : value === 'PER_100_SQ_M' ? '分/100平方米' : null;

/** Construct a new immutable allowlist; never return the source report snapshot. */
export function buildCustomerView(input: unknown) {
 const parsed=source.safeParse(input); if(!parsed.success) throw AppError.invalidState('已确认报告缺少可分享的必要内容');
 const s=parsed.data; const photoRefs: {objectKey:string}[]=[];
 const plan=s.plan.mode==='FULL'?'全检':s.plan.mode==='FIXED_PER_LOT'?`每缸固定抽检 ${s.plan.fixedRolls} 卷（不足时按实有卷数）`:s.plan.mode==='PERCENT_PER_LOT'?`每缸按 ${s.plan.percent}% 抽检`:null;
 if(!plan) throw AppError.invalidState('已确认报告抽检方案不完整');
 const lines=s.lines.map(l=>({customerOrderNo:l.customerOrderNo??null,productName:l.productName??null,specification:l.specification??null,color:l.color??null,quantity:l.quantity??null,quantityUnit:l.quantityUnit??null}));
 const rolls=s.rolls.map(r=>{
  const lineNumber=s.lines.findIndex(l=>l.id===r.lineId)+1; if(!lineNumber || !['PASS','FAIL','UNINSPECTED','INCOMPLETE'].includes(r.result)) throw AppError.invalidState('已确认报告卷记录不完整');
  const events=[...(r.basisHistory?[{kind:'ORIGINAL' as const,data:r.basisHistory}]:[]),...(r.additionalHistory??[]).filter(e=>e.result==='PASS'||e.result==='FAIL').map(data=>({kind:'ADDITIONAL' as const,data}))];
  const history=events.map(({kind,data:e})=>{
   if(!e.inspectionId || !e.inspection || !e.submittedAt || !e.reviewedAt || !['PASS','FAIL'].includes(e.result??'') || (e.finalResult && (!['PASS','FAIL'].includes(e.finalResult) || !e.finalReason?.trim()))) throw AppError.invalidState('已确认报告检验资料不完整');
   const scores=e.resultSnapshot?.fourPoint?.scoring;
   const defects=e.inspection.defects.map(d=>({name:d.defectTypeCode?s.defectNames[d.defectTypeCode]??d.defectTypeCode:'',positionM:d.positionM??null,lengthCm:d.lengthCm??null,widthCm:d.widthCm??null,points:d.points??null,effectivePoints:scores?.defectScores?.find(v=>v.clientId===d.clientId)?.effectivePoints??null}));
   const photoIndexes:number[]=[];
   for(const p of e.inspection.photos){
    if(p.kind!=='DEFECT') continue;
    if(!p.defectClientId || !e.inspection.defects.some(d=>d.clientId===p.defectClientId) || !p.objectKey?.startsWith(`frozen-inspections/${e.inspectionId}/`) || p.objectKey.split('/').some(segment=>segment==='.' || segment==='..') || p.objectKey.includes('\\')) throw AppError.invalidState('已确认报告照片归属不明');
    photoIndexes.push(photoRefs.length);photoRefs.push({objectKey:p.objectKey});
   }
   return {kind,result:e.result,systemResult:e.systemResult??null,finalResult:e.finalResult??null,finalReason:e.finalReason??null,submittedAt:e.submittedAt,reviewedAt:e.reviewedAt,totalPoints:e.totalPoints??null,normalizedScore:e.normalizedScore??null,scoreUnit:unit(scores?.areaUnit),defects,photoIndexes};
  });
  if ((r.originalSample && !history.some(e=>e.kind==='ORIGINAL')) || (['PASS','FAIL'].includes(r.result) && history.length===0)) throw AppError.invalidState('已确认报告缺少受检依据');
  history.sort((a,b)=>Date.parse(a.reviewedAt)-Date.parse(b.reviewedAt));
  const pendingAdditionalInspectionCount=Math.max((r.additionalHistory??[]).filter(e=>e.result!=='PASS' && e.result!=='FAIL').length,r.pendingAdditional?1:0);
  return {lineNumber,lotNo:r.lotNo,rollNo:r.rollNo,originalSample:r.originalSample,additionalSample:r.additionalSample??false,result:history.at(-1)?.result??r.result,nominalLengthM:r.nominalLengthM??null,nominalWeightKg:r.nominalWeightKg??null,measuredLengthM:r.measuredLengthM??null,measuredWeightKg:r.measuredWeightKg??null,pendingAdditionalInspectionCount,history};
 });
 const pendingActions=rolls.filter(r=>r.pendingAdditionalInspectionCount>0).map(r=>`卷 ${r.rollNo}：追加检验待处理`);
 return {view:{hNo:s.hNo,version:s.version,confirmedAt:s.confirmedAt,inspectionPlanDescription:plan,originalRequiredRolls:s.originalRequiredRolls,standardName:s.standardName??null,lines,rolls,pendingActions},photoRefs};
}
export type CustomerView = ReturnType<typeof buildCustomerView>['view'];
