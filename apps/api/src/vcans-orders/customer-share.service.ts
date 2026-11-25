import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RoleCode } from '@fabricqc/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import { businessDepartments } from '../tasks/business-access';
import { StorageAdapter } from '../media/storage.adapter';
import { prepareReportPhoto } from './report-photo';
import { renderOrderReport, type OrderReportInput, type ReportInspectionHistoryEntry } from './document-renderer';
import { buildCustomerView, type CustomerView } from './customer-share-view';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/decorators';

const lifetime = 7 * 24 * 60 * 60 * 1000;
const tokenPattern = /^ysr_[A-Za-z0-9_-]{43}$/;
const hidden = () => AppError.notFound('分享');
const refsSchema = z.array(z.object({objectKey:z.string().startsWith('frozen-inspections/')})).max(500);
function canRead(actor:Actor, order:{businessDepartmentId:string;supervisorId:string|null;assignedInspectorId:string|null}) {
 return businessDepartments(actor).includes(order.businessDepartmentId) || (order.supervisorId===actor.userId && actor.roles.some(r=>r.role===RoleCode.QC_SUPERVISOR)) || (order.assignedInspectorId===actor.userId && actor.roles.some(r=>r.role===RoleCode.INSPECTOR)) || actor.roles.some(r=>r.role===RoleCode.ADMIN || r.role===RoleCode.QUALITY_MANAGER);
}
function manager(actor:Actor){return actor.roles.some(r=>r.role===RoleCode.ADMIN || r.role===RoleCode.QUALITY_MANAGER);}
function projectionHash(view:CustomerView,refs:{objectKey:string}[]){return createHash('sha256').update(JSON.stringify({view,refs})).digest('hex');}

@Injectable()
export class CustomerShareService {
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageAdapter,private readonly config:AppConfig,private readonly audit:AuditService){}
 private async orderAccess(actor:Actor,id:string){
  const order=await this.prisma.vcansOrder.findUnique({where:{id},include:{task:{select:{status:true}}}});
  if(!order || !canRead(actor,order)) throw AppError.forbidden('没有该订单报告权限');
  return order;
 }
 private async currentReport(actor:Actor,id:string){
  if(this.config.env.DEMO_RUNTIME_MODE==='demo') throw AppError.forbidden('演示环境不支持客户分享');
  const order=await this.prisma.vcansOrder.findUnique({where:{id},include:{task:{select:{status:true}},reports:{orderBy:{version:'desc'},take:1}}});
  if(!order || !canRead(actor,order)) throw AppError.forbidden('没有该订单报告权限');
  const report=order.reports[0];
  if(order.purpose!=='FORMAL' || !order.confirmedAt || order.task?.status==='CANCELLED' || !report || report.confirmedAt.getTime()!==order.confirmedAt.getTime()) throw AppError.invalidState('该订单尚无可分享的已确认报告');
  const projection=buildCustomerView(report.snapshot);
  if(projection.view.version!==report.version || projection.view.hNo!==order.hNo || new Date(projection.view.confirmedAt).getTime()!==report.confirmedAt.getTime()) throw AppError.invalidState('报告冻结信息不一致');
  return {report,...projection};
 }
 private reviewNotes(view:CustomerView){return view.rolls.flatMap(roll=>roll.history.filter(h=>h.finalResult && h.finalReason?.trim()).map(h=>({rollNo:roll.rollNo,reason:h.finalReason!})));}
 async preview(actor:Actor,id:string){const {report,view,photoRefs}=await this.currentReport(actor,id);const reviewNotes=this.reviewNotes(view);return {reportVersion:report.version,reviewNotes,photoCount:photoRefs.length,requiresConfirmation:reviewNotes.length>0 || photoRefs.length>0};}
 async previewPdf(actor:Actor,id:string,version:number,meta:RequestMeta){const s=await this.currentReport(actor,id);if(s.report.version!==version)throw AppError.invalidState('报告版本已变化，请重新预览');const bytes=await this.render(s.view,s.photoRefs);const latest=await this.currentReport(actor,id);const hash=projectionHash(s.view,s.photoRefs);if(latest.report.id!==s.report.id || projectionHash(latest.view,latest.photoRefs)!==hash)throw AppError.invalidState('报告版本已变化，请重新预览');await this.audit.log(actor,{action:'customer_share.preview',entityType:'VcansReportVersion',entityId:s.report.id,after:{reportVersion:version,projectionHash:hash}},meta);return bytes;}
 async create(actor:Actor,id:string,input:{reportVersion:number;acknowledgeContent?:boolean},meta:RequestMeta){
  if(this.config.env.DEMO_RUNTIME_MODE==='demo') throw AppError.forbidden('演示环境不支持客户分享');
  await this.orderAccess(actor,id);
  const token=`ysr_${randomBytes(32).toString('base64url')}`;const tokenHash=createHash('sha256').update(token).digest('hex');const now=new Date();const expiresAt=new Date(now.getTime()+lifetime);
  const share=await this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM vcans_orders WHERE id = ${id}::uuid FOR UPDATE`;
   const order=await tx.vcansOrder.findUnique({where:{id},include:{task:{select:{status:true}},reports:{orderBy:{version:'desc'},take:1}}});
   if(!order || !canRead(actor,order)) throw AppError.forbidden('没有该订单报告权限');
   const report=order.reports[0];
   if(order.purpose!=='FORMAL' || !order.confirmedAt || order.task?.status==='CANCELLED' || !report || report.confirmedAt.getTime()!==order.confirmedAt.getTime()) throw AppError.invalidState('该订单尚无可分享的已确认报告');
   const {view,photoRefs}=buildCustomerView(report.snapshot);
   if(view.version!==report.version || view.hNo!==order.hNo || new Date(view.confirmedAt).getTime()!==report.confirmedAt.getTime()) throw AppError.invalidState('报告冻结信息不一致');
   if(report.version!==input.reportVersion) throw AppError.invalidState('报告版本已变化，请重新预览');
   const requiresConfirmation=this.reviewNotes(view).length>0 || photoRefs.length>0;
   if(requiresConfirmation && input.acknowledgeContent!==true) throw AppError.badRequest('请确认复核说明和照片可对外分享');
   if(requiresConfirmation){const preview=await tx.auditLog.findFirst({where:{actorId:actor.userId,action:'customer_share.preview',entityType:'VcansReportVersion',entityId:report.id},orderBy:{createdAt:'desc'},select:{after:true}});const data=preview?.after as {projectionHash?:unknown}|null;if(data?.projectionHash!==projectionHash(view,photoRefs))throw AppError.badRequest('请先预览本版本客户报告');}
   const created=await tx.vcansReportShare.create({data:{reportVersionId:report.id,issuedById:actor.userId,tokenHash,createdAt:now,expiresAt,frozenView:view as Prisma.InputJsonValue,privatePhotoRefs:photoRefs as Prisma.InputJsonValue},select:{id:true,expiresAt:true,reportVersion:{select:{version:true}}}});
   await this.audit.log(actor,{action:'customer_share.create',entityType:'VcansReportShare',entityId:created.id,after:{reportVersion:report.version,contentConfirmed:requiresConfirmation}},meta,tx);
   return created;
  });
  return {id:share.id,token,expiresAt:share.expiresAt,reportVersion:share.reportVersion.version};
 }
 async list(actor:Actor,id:string){
  await this.orderAccess(actor,id);
  if(this.config.env.DEMO_RUNTIME_MODE==='demo') return {items:[]};
  const rows=await this.prisma.vcansReportShare.findMany({where:{reportVersion:{orderId:id},...(!manager(actor)?{issuedById:actor.userId}:{})},orderBy:{createdAt:'desc'},select:{id:true,issuedById:true,createdAt:true,expiresAt:true,revokedAt:true,reportVersion:{select:{version:true}}}});
  return {items:rows.map(r=>({id:r.id,createdAt:r.createdAt,expiresAt:r.expiresAt,revokedAt:r.revokedAt,reportVersion:r.reportVersion.version,canRevoke:!r.revokedAt && (manager(actor)||r.issuedById===actor.userId)}))};
 }
 async revoke(actor:Actor,id:string,shareId:string,meta:RequestMeta){
  await this.orderAccess(actor,id);
  if(this.config.env.DEMO_RUNTIME_MODE==='demo') throw hidden();
  const result=await this.prisma.$transaction(async tx=>{
   const row=await tx.vcansReportShare.findFirst({where:{id:shareId,reportVersion:{orderId:id}},select:{id:true,issuedById:true,revokedAt:true}});
   if(!row || (!manager(actor) && row.issuedById!==actor.userId)) throw hidden();
   if(row.revokedAt) return row.revokedAt;
   const revokedAt=new Date(); const changed=await tx.vcansReportShare.updateMany({where:{id:shareId,revokedAt:null},data:{revokedAt,revokedById:actor.userId}});
   if(changed.count===1){await this.audit.log(actor,{action:'customer_share.revoke',entityType:'VcansReportShare',entityId:shareId},meta,tx);return revokedAt;}
   const existing=await tx.vcansReportShare.findUniqueOrThrow({where:{id:shareId},select:{revokedAt:true}});return existing.revokedAt!;
  });
  return {id:shareId,revokedAt:result};
 }
 private async get(token?:string){
  if(this.config.env.DEMO_RUNTIME_MODE==='demo' || typeof token!=='string' || !tokenPattern.test(token)) throw hidden();
  const tokenHash=createHash('sha256').update(token).digest('hex');
  const share=await this.prisma.vcansReportShare.findUnique({where:{tokenHash},include:{reportVersion:{include:{order:{include:{task:{select:{status:true}}}}}}}});
  if(!share || share.revokedAt || share.expiresAt.getTime()<=Date.now() || share.reportVersion.order.purpose!=='FORMAL' || share.reportVersion.order.task?.status==='CANCELLED') throw hidden();
  const refs=refsSchema.safeParse(share.privatePhotoRefs);if(!refs.success) throw hidden();
  return {view:share.frozenView as unknown as CustomerView,refs:refs.data,expiresAt:share.expiresAt,reportVersion:share.reportVersion.version};
 }
 async current(token?:string){const s=await this.get(token);return {reportVersion:s.reportVersion,expiresAt:s.expiresAt,report:s.view};}
 private async photoBytes(key:string){try{return (await prepareReportPhoto(await this.storage.readBytes(key,20*1024*1024),{kind:'DEFECT'},[],{})).bytes;}catch{throw AppError.invalidState('报告图片暂不可用');}}
 async photo(token:string|undefined,index:number){const s=await this.get(token);if(!Number.isSafeInteger(index)||index<0||index>=s.refs.length)throw hidden();const bytes=await this.photoBytes(s.refs[index].objectKey);await this.get(token);return bytes;}
 private async render(v:CustomerView,refs:{objectKey:string}[]){
  let totalBytes=0;
  const lines=v.lines.map((line,i)=>({...line,id:`line-${i+1}`}));
  const rolls:OrderReportInput['rolls']=[];
  for(let i=0;i<v.rolls.length;i++){
   const r=v.rolls[i];const history:ReportInspectionHistoryEntry[]=[];
   for(let j=0;j<r.history.length;j++){
    const e=r.history[j];const photos=[];
    for(const index of e.photoIndexes){if(!refs[index])throw hidden();const bytes=await this.photoBytes(refs[index].objectKey);totalBytes+=bytes.length;if(totalBytes>64*1024*1024)throw AppError.invalidState('报告照片过多');photos.push({bytes});}
    history.push({id:`inspection-${i}-${j}`,hideInspectionNumber:true,kind:e.kind,result:e.result as 'PASS'|'FAIL',inspectedAt:e.submittedAt,reviewedAt:e.reviewedAt,totalPoints:e.totalPoints,normalizedScore:e.normalizedScore,scoreUnit:e.scoreUnit,conclusionNote:e.finalResult?`主管复核${e.finalResult==='PASS'?'合格':'不合格'}：${e.finalReason??''}；系统原判：${e.systemResult==='PASS'?'合格':e.systemResult==='FAIL'?'不合格':'待复核'}`:null,defects:e.defects,photos});
   }
   history.sort((a,b)=>Date.parse(a.reviewedAt)-Date.parse(b.reviewedAt));
   rolls.push({id:`roll-${i}`,lineId:`line-${r.lineNumber}`,lotNo:r.lotNo,rollNo:r.rollNo,originalSample:r.originalSample,additionalSample:r.additionalSample,result:r.result as 'PASS'|'FAIL'|'UNINSPECTED'|'INCOMPLETE',nominalLengthM:r.nominalLengthM,nominalWeightKg:r.nominalWeightKg,measuredLengthM:r.measuredLengthM,measuredWeightKg:r.measuredWeightKg,pendingAdditionalInspectionCount:r.pendingAdditionalInspectionCount,...(history.length?{inspectionHistory:history,latestReviewedInspectionId:history.at(-1)!.id}:{})});
  }
  const bytes=await renderOrderReport({reportNumber:`${v.hNo}-V${v.version}`,hNo:v.hNo,version:v.version,confirmedAt:v.confirmedAt,confirmedByName:'已确认',inspectorNames:[],inspectionPlanDescription:v.inspectionPlanDescription,originalRequiredRolls:v.originalRequiredRolls,lines,rolls,standardName:v.standardName,pendingActions:v.pendingActions});
  return bytes;
 }
 async pdf(token?:string){const s=await this.get(token);const bytes=await this.render(s.view,s.refs);await this.get(token);return bytes;}
}
