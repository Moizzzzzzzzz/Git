import type { BusinessProgress } from './business-workflow';
export type BusinessStage='unassigned'|'inspecting'|'confirming'|'completed'|'cancelled';
export type BusinessFilter=BusinessStage|'all';
export interface BusinessHomeTask extends BusinessProgress { status:string;createdAt:string;supervisor:{id:string;name:string}|null;finalConfirmationReady:boolean;canRemind:boolean }
export const BUSINESS_STAGES=[{key:'unassigned',label:'待分发'},{key:'inspecting',label:'验布中'},{key:'confirming',label:'待主管确认'},{key:'completed',label:'已完成'}] as const;
export function businessStage(t:BusinessHomeTask):BusinessStage {
 if(t.status==='CANCELLED')return 'cancelled';
 if(t.delivered)return 'completed';
 if(!t.assigned)return 'unassigned';
 if(t.planned>0&&t.inspected===t.planned)return 'confirming';
 return 'inspecting';
}
export function stageLabel(t:BusinessHomeTask){const s=businessStage(t);return s==='cancelled'?'已取消':BUSINESS_STAGES.find(x=>x.key===s)!.label;}
export function businessCounts(items:BusinessHomeTask[]){const counts={unassigned:0,inspecting:0,confirming:0,completed:0};for(const t of items){const s=businessStage(t);if(s!=='cancelled')counts[s]++;}return counts;}
export function filterBusinessTasks(items:BusinessHomeTask[],query:string,stage:BusinessFilter='all',follow=false){const q=query.trim().toLocaleLowerCase();return items.filter(t=>(!q||t.title.toLocaleLowerCase().includes(q)||t.taskNo.toLocaleLowerCase().includes(q))&&(stage==='all'||businessStage(t)===stage)&&(!follow||(t.canRemind&&businessStage(t)!=='cancelled')));}
export function inspectionPercent(t:BusinessHomeTask){return t.planned>0?Math.max(0,Math.min(100,t.inspected/t.planned*100)):0;}
/** Missing the new server contract must never be silently classified as zero/ready. */
export function readBusinessHomeItems(value:unknown):BusinessHomeTask[]{
 const items=(value as {items?:unknown})?.items;
 if(!Array.isArray(items)||items.some(t=>!t||typeof t.id!=='string'||typeof t.title!=='string'||typeof t.taskNo!=='string'||typeof t.status!=='string'||typeof t.createdAt!=='string'||!Number.isFinite(Date.parse(t.createdAt))||typeof t.canRemind!=='boolean'||typeof t.finalConfirmationReady!=='boolean'||typeof t.assigned!=='boolean'||typeof t.delivered!=='boolean'||!Number.isInteger(t.planned)||t.planned<=0||!Number.isInteger(t.inspected)||t.inspected<0||t.inspected>t.planned||!Number.isInteger(t.uninspected)||t.uninspected<0||t.uninspected>t.planned||t.inspected+t.uninspected!==t.planned||!('supervisor' in t)||(t.supervisor!==null&&(typeof t.supervisor?.id!=='string'||typeof t.supervisor?.name!=='string'))))throw new Error('首页数据更新中，请稍后重试');
 return items as BusinessHomeTask[];
}
export function businessListUrl(query='',stage:BusinessFilter='all',follow=false){return `/pages/business/list?q=${encodeURIComponent(query)}&stage=${stage}${follow?'&follow=1':''}`;}
