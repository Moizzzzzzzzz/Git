import type {RoleCode} from '@fabricqc/shared';
export interface ReminderTemplates {reviewRequest:string|null;reviewResult:string|null;taskDelivered:string|null}
export interface ReminderSubscription {templateId:string;remaining:number}
export interface ReminderConfiguration {templates:ReminderTemplates;subscriptions:ReminderSubscription[]}
export function reminderAllowances(roles:readonly RoleCode[],templates:ReminderTemplates,subscriptions:ReminderSubscription[]){
 const items:{key:keyof ReminderTemplates;label:string}[]=[];
 if(roles.includes('SALES'))items.push({key:'taskDelivered',label:'整单完成提醒'});
 if(roles.includes('QC_SUPERVISOR')||roles.includes('QUALITY_MANAGER'))items.push({key:'reviewRequest',label:'待审核提醒'});
 if(roles.includes('INSPECTOR'))items.push({key:'reviewResult',label:'验布审核结果提醒'});
 return items.map(item=>{const id=templates[item.key];const sub=subscriptions.find(s=>s.templateId===id);return {...item,status:!id?'模板未配置':!sub?'尚未授权':`可用 ${sub.remaining} 次`};});
}
