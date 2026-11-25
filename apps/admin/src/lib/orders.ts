import {requiredSampleCount} from '@fabricqc/shared';
import type {RoleCode, VcansInspectionPlan} from '@fabricqc/shared';
export const PLAN_NAMES = {FULL:'全检',FIXED_PER_LOT:'每缸固定卷数',PERCENT_PER_LOT:'每缸按比例抽检'};
export interface OrderLine {id?:string;lineNo?:number;customerOrderNo:string|null;productName:string|null;productCode:string|null;color:string|null;specification:string|null;quantity:string|null;quantityUnit:string|null}
export interface OrderCapabilities {canEdit?:boolean;canRegister?:boolean;canSelectSamples?:boolean;canConfirmArrival?:boolean;canAssign?:boolean;canConfirm?:boolean;canRemind?:boolean;canExport?:boolean;canConfigure?:boolean;canConfigureCustomerStandard?:boolean;canInspect?:boolean;canAddAdditional?:boolean;canPrintLabels?:boolean}
export interface OrderProgress {totalRolls:number;originalRequired:number;originalReviewed:number;originalInspected?:number;originalPending?:number;additionalCount:number}
export interface OrderSummary {id:string;hNo:string;businessDepartmentId:string;taskId:string|null;version:number;arrivalComplete:boolean;planMode:keyof typeof PLAN_NAMES;fixedRolls?:number|null;percent?:string|null;createdAt?:string;dueAt?:string|null;supervisorId?:string|null;assigneeId?:string|null;assignedInspectorId?:string|null;confirmedAt?:string|null;fourPointStandardId?:string|null;customerId?:string|null;customerStandardId?:string|null;standardSource?:'FACTORY'|'CUSTOMER'|null;templateId?:string|null;progress?:OrderProgress;capabilities?:OrderCapabilities;status?:string}
export interface OrderLot {id:string;lineId:string;dyeLotNo:string;actualRollCount:number;version:number;originalRequired?:number;requiredSampleCount?:number}
export interface OrderRoll {id:string;rollId?:string;lotId:string;rollNo:string;qrCode?:string;nominalLengthM:string|null;nominalWeightKg:string|null;measuredLengthM:string|null;measuredWeightKg:string|null;originalSelected?:boolean;selectedForOriginal?:boolean;inspectionPurpose?:string|null;inspectionId?:string|null;roll?:{rollNo:string;qrCode:string};selections?:{kind:string;basisInspectionId?:string|null;basisRevisionId?:string|null}[];taskRoll?:{id:string;status:string;inspection?:{id:string;status:string}|null;inspections?:{id:string;status:string}[]}|null;status?:string;overallResult?:string|null}
export interface OrderDetail {order:OrderSummary;lines:OrderLine[];lots:OrderLot[];rolls:OrderRoll[];capabilities:OrderCapabilities;progress?:OrderProgress;activationBlockers?:string[]}
export interface CustomerStandardOption {id:string;code:string;name:string;customer:{id:string;name:string;code:string}|null;currentVersion:{id:string;version:number}|null}
export interface OrderOptions {customerStandards?:CustomerStandardOption[];departments:{id:string;name:string}[];supervisors:{id:string;name:string}[];inspectors?:{id:string;name:string}[];standards?:{id:string;name:string;isDevDefault?:boolean;currentVersion?:{isDevDefault?:boolean}|null}[];templates?:{id:string;name:string}[]}
export interface LineForm {id?:string;customerOrderNo:string;productName:string;productCode:string;color:string;specification:string;quantity:string;quantityUnit:string}
export interface OrderForm {hNo:string;businessDepartmentId:string;supervisorId:string;dueDate:string;planMode:keyof typeof PLAN_NAMES;sampleValue:string;fourPointStandardId:string;templateId:string;lines:LineForm[]}
export const emptyLine = ():LineForm=>({customerOrderNo:'',productName:'',productCode:'',color:'',specification:'',quantity:'',quantityUnit:'米'});
export const emptyOrderForm = ():OrderForm=>({hNo:'',businessDepartmentId:'',supervisorId:'',dueDate:'',planMode:'FULL',sampleValue:'',fourPointStandardId:'',templateId:'',lines:[emptyLine()]});
export function canCreateOrder(roles:readonly RoleCode[]){return roles.some(r=>['SALES','BUSINESS_MANAGER','BUSINESS_CLERK'].includes(r));}
export function displayQuantity(value:string|number|null|undefined,unit:string){return value===null||value===undefined||value===''?'—':`${value} ${unit}`;}
const decimal=/^\d{1,14}(?:\.\d{1,4})?$/;
export function toOrderInput(f:OrderForm){
 if(!f.hNo.trim()||!f.businessDepartmentId||!f.supervisorId)throw new Error('请填写 H 号、业务部门和质检主管');
 if(!f.lines.length)throw new Error('请至少填写一条订单明细');
 let plan:VcansInspectionPlan={mode:'FULL'};
 if(f.planMode==='FIXED_PER_LOT'){const n=Number(f.sampleValue);if(!/^\d+$/.test(f.sampleValue)||!Number.isSafeInteger(n)||n<1)throw new Error('每缸抽检卷数须为正整数');plan={mode:f.planMode,fixedRolls:n};}
 if(f.planMode==='PERCENT_PER_LOT'){if(!/^\d{1,3}(?:\.\d{1,4})?$/.test(f.sampleValue)||Number(f.sampleValue)<=0||Number(f.sampleValue)>100)throw new Error('抽检比例须大于 0 且不超过 100');plan={mode:f.planMode,percent:f.sampleValue};}
 const text=(v:string)=>v.trim()||null;
 const lines=f.lines.map(l=>{if(l.quantity&&!decimal.test(l.quantity))throw new Error('订单量请填写非负数，最多四位小数');return {customerOrderNo:text(l.customerOrderNo),productName:text(l.productName),productCode:text(l.productCode),color:text(l.color),specification:text(l.specification),quantity:text(l.quantity),quantityUnit:text(l.quantityUnit)};});
 let dueAt:string|null=null;if(f.dueDate){if(!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)||!Number.isFinite(Date.parse(`${f.dueDate}T23:59:59+08:00`)))throw new Error('请填写有效验布截止日期');dueAt=`${f.dueDate}T23:59:59+08:00`;}
 return {hNo:f.hNo.trim().toUpperCase(),businessDepartmentId:f.businessDepartmentId,supervisorId:f.supervisorId,dueAt,plan,...(f.fourPointStandardId?{fourPointStandardId:f.fourPointStandardId}:{}),...(f.templateId?{templateId:f.templateId}:{}),lines};
}
export function orderFormFromDetail(d:OrderDetail):OrderForm {return {hNo:d.order.hNo,businessDepartmentId:d.order.businessDepartmentId,supervisorId:d.order.supervisorId??'',dueDate:d.order.dueAt?.slice(0,10)??'',planMode:d.order.planMode,sampleValue:d.order.planMode==='FIXED_PER_LOT'?String(d.order.fixedRolls??''):d.order.percent??'',fourPointStandardId:d.order.fourPointStandardId??'',templateId:d.order.templateId??'',lines:d.lines.map(l=>({id:l.id,customerOrderNo:l.customerOrderNo??'',productName:l.productName??'',productCode:l.productCode??'',color:l.color??'',specification:l.specification??'',quantity:l.quantity??'',quantityUnit:l.quantityUnit??''}))};}

export const rollNumber=(r:OrderRoll)=>r.rollNo??r.roll?.rollNo??r.rollId??r.id;
export const isOriginalSelected=(r:OrderRoll)=>r.originalSelected===true||r.selectedForOriginal===true||r.selections?.some(s=>s.kind==='ORIGINAL')===true;

export function changedOrderPlan(form:OrderForm, detail:OrderDetail){const before=orderFormFromDetail(detail);return before.planMode===form.planMode&&(form.planMode==='FULL'||Number(before.sampleValue)===Number(form.sampleValue))?undefined:toOrderInput(form).plan;}

export const ORDER_STATUS_LABELS:Record<string,string>={UNASSIGNED:'待分发',INSPECTING:'验布中',PENDING_CONFIRMATION:'待主管确认',COMPLETED:'已完成'};

export function lotRequired(order:OrderSummary,lot:OrderLot){return requiredSampleCount(lot.actualRollCount,order.planMode==='FULL'?{mode:'FULL'}:order.planMode==='FIXED_PER_LOT'?{mode:'FIXED_PER_LOT',fixedRolls:order.fixedRolls!}:{mode:'PERCENT_PER_LOT',percent:order.percent!});}

export const mayAddInspection=(r:OrderRoll)=>!isOriginalSelected(r)||r.selections?.some(s=>s.kind==='ORIGINAL'&&s.basisInspectionId&&s.basisRevisionId)===true;

export interface OrderCustomerOptions {customers:{id:string;code:string;name:string}[];customerStandards:(CustomerStandardOption & {customer:{id:string;name:string;code:string};currentVersion:{id:string;version:number}})[]}
