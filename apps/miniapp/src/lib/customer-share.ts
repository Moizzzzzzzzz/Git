import Taro from '@tarojs/taro';
import {API_BASE_URL} from './config';
export const CUSTOMER_SHARE_UNAVAILABLE='分享暂时无法访问，请向发送人核实是否已过期或撤回。';
export interface CustomerReportSummary {reportVersion:number;expiresAt:string;report:{hNo:string;version:number;confirmedAt:string;inspectionPlanDescription?:string;originalRequiredRolls?:number;standardName?:string|null;pendingActions?:string[]}}
export interface CreatedCustomerShare {id:string;token:string;expiresAt:string;reportVersion:number}
export interface CustomerShareItem {id:string;createdAt:string;expiresAt:string;revokedAt:string|null;reportVersion:number;canRevoke:boolean}
export function validShareToken(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
export function customerCard(value:{token:string;expiresAt:string}|null,imageUrl:string,now=Date.now()){
 const usable=value&&validShareToken(value.token)&&Date.parse(value.expiresAt)>now;
 return {title:'永盛集团质检平台 · 验布报告',path:usable?`/pages/customer-share/index?t=${value.token}`:'/pages/index/index',imageUrl};
}
function headers(token:string){if(!validShareToken(token))throw new Error(CUSTOMER_SHARE_UNAVAILABLE);return {'X-Fabricqc-Share-Token':token};}
/** Public transport is deliberately separate from employee and demo sessions. */
export async function readCustomerShare(token:string):Promise<CustomerReportSummary>{
 try{
  const r=await Taro.request<CustomerReportSummary>({url:`${API_BASE_URL}/customer-shares/current`,method:'GET',header:headers(token),timeout:20000});
  if(r.statusCode!==200||!r.data?.report||typeof r.data.report.hNo!=='string'||typeof r.data.reportVersion!=='number'||!r.data.report.confirmedAt)throw Error();
  return r.data;
 }catch{throw new Error(CUSTOMER_SHARE_UNAVAILABLE);}
}
export async function downloadCustomerShare(token:string):Promise<string>{
 try{
  const r=await Taro.downloadFile({url:`${API_BASE_URL}/customer-shares/current/pdf`,header:headers(token),timeout:30000});
  if(r.statusCode!==200||!r.tempFilePath)throw Error();
  return r.tempFilePath;
 }catch{throw new Error(CUSTOMER_SHARE_UNAVAILABLE);}
}

export function customerCreateBody(preview:{reportVersion:number;requiresConfirmation:boolean},viewedVersion:number|null,acknowledged:boolean):{reportVersion:number;acknowledgeContent?:boolean}{if(!Number.isInteger(preview.reportVersion)||preview.reportVersion<1)throw new Error('报告版本不可用');if(preview.requiresConfirmation){if(viewedVersion!==preview.reportVersion||!acknowledged)throw new Error('请先预览同一版本并确认内容可对外发送');return {reportVersion:preview.reportVersion,acknowledgeContent:true};}return {reportVersion:preview.reportVersion};}

export interface CustomerSharePreview {reportVersion:number;reviewNotes:{rollNo:string;reason:string}[];photoCount:number;requiresConfirmation:boolean}
