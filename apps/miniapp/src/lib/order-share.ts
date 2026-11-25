/** Only a fixed order identifier is accepted; never an arbitrary return URL. */
export function parseSharedOrderId(value:unknown):string|null {
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
}
export function internalCard(id:unknown,allowed:boolean,imageUrl:string){
 const target=parseSharedOrderId(id);
 return {title:'永盛集团质检平台 · 订单协作',path:allowed&&target?`/pages/order-share/index?id=${target}`:'/pages/index/index',imageUrl};
}
type Dependencies={isCurrentReal:()=>boolean;login:()=>Promise<'READY'|'NEED_BIND'>;read:(id:string)=>Promise<unknown>};
type Outcome={kind:'bind'|'open';id:string}|{kind:'switch'}|{kind:'unavailable'};
export async function resolveInternalOrder(value:unknown,deps:Dependencies):Promise<Outcome>{
 const id=parseSharedOrderId(value);if(!id)return {kind:'unavailable'};
 if(!deps.isCurrentReal())return {kind:'switch'};
 try{
  const state=await deps.login();
  if(!deps.isCurrentReal())return {kind:'switch'};
  if(state==='NEED_BIND')return {kind:'bind',id};
  await deps.read(id);
  if(!deps.isCurrentReal())return {kind:'switch'};
  return {kind:'open',id};
 }catch{return {kind:'unavailable'};}
}
