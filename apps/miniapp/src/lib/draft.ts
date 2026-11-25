import Taro from '@tarojs/taro';
import { evaluateInspection, type InspectionEvaluation } from '@fabricqc/quality-engine';
import {
  standardRulesSchema,
  type DefectSeverity,
  type InspectionDraft,
  type InspectionMode,
  type InspectionScope,
  type MediaKind,
} from '@fabricqc/shared';
import { requestScoped, ApiError, errorText } from './api';
import { currentContext, contextScope, contextPhase, sameIdentity, onContextPause, type SessionContext } from './session-context';
import { withContextWrite } from './demo-session';
import type { InspectionDetail } from './types';

export type PhotoStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface LocalPhoto {
  localId: string;
  kind: MediaKind;
  checkpointKey: string | null;
  defectClientId: string | null;
  /** 本机持久化文件（拍照后保存），服务端已有的照片为空 */
  localPath: string | null;
  thumbPath: string | null;
  /** 服务端照片的临时查看链接 */
  remoteThumb: string | null;
  mediaId: string | null;
  status: PhotoStatus;
  error?: string;
}

export interface LocalDefect {
  clientId: string;
  defectTypeCode: string;
  lengthCm: number;
  widthCm: number | null;
  positionM: number;
  widthPositionCm: number | null;
  severity: DefectSeverity;
  remark: string | null;
}

export type SyncState = 'idle' | 'syncing' | 'error' | 'conflict';

export interface LocalDraft {
  inspectionId: string;
  /** 本地草稿所基于的服务端版本 */
  baseVersion: number;
  /** 本地修改计数，用于判断同步期间是否又有修改 */
  localRev: number;
  syncedRev: number;
  syncState: SyncState;
  syncError: string | null;
  lastSyncedAt: number | null;
  savedAt: number;
  mode: InspectionMode;
  scope: InspectionScope;
  segments: { startM: number; endM: number }[];
  measurements: { itemKey: string; seq: number; value: number }[];
  checklist: { key: string; status: 'OK' | 'NG' | 'NA'; note?: string | null }[];
  defects: LocalDefect[];
  photos: LocalPhoto[];
  remarks: string;
  serverEvaluation: InspectionEvaluation | null;
  /** 提交幂等键：同一次提交的重试使用同一个键 */
  submitKey: string | null;
  meta: Pick<InspectionDetail, 'status' | 'revision' | 'roll' | 'task' | 'spec' | 'template' | 'standards'>;
}

const indexKey=(c:SessionContext)=>c.kind==='real'?'fqc_drafts':`fqc_demo_drafts_${contextScope(c)}`;
const key=(id:string,c:SessionContext)=>c.kind==='real'?`fqc_draft_${id}`:`fqc_demo_draft_${contextScope(c)}_${id}`;
export const draftEvent=(id:string,c:SessionContext=currentContext())=>c.kind==='real'?`draft:${id}`:`draft:${contextScope(c)}:${id}`;
export function isDirty(d:LocalDraft){return d.localRev!==d.syncedRev;}
function index(c:SessionContext):string[]{return Taro.getStorageSync(indexKey(c))||[];}
export function listLocalDrafts(c:SessionContext=currentContext()):LocalDraft[]{return index(c).map(id=>loadDraft(id,c)).filter((d):d is LocalDraft=>!!d);}
export function loadDraft(id:string,c:SessionContext=currentContext()):LocalDraft|null{return Taro.getStorageSync(key(id,c))||null;}
function persist(d:LocalDraft,c:SessionContext){d.savedAt=Date.now();Taro.setStorageSync(key(d.inspectionId,c),d);const ids=index(c);if(!ids.includes(d.inspectionId))Taro.setStorageSync(indexKey(c),[...ids,d.inspectionId]);Taro.eventCenter.trigger(draftEvent(d.inspectionId,c),d);}
export function removeDraft(id:string,c:SessionContext=currentContext()){
 const d=loadDraft(id,c),fs=Taro.getFileSystemManager();
 d?.photos.forEach(p=>{for(const f of [p.localPath,p.thumbPath])if(f){try{fs.unlinkSync(f);}catch{/* keep other scopes untouched */}}});
 Taro.removeStorageSync(key(id,c));Taro.setStorageSync(indexKey(c),index(c).filter(x=>x!==id));
}

/** 用服务端数据初始化（或覆盖）本地草稿 */
export function draftFromServer(detail: InspectionDetail, c:SessionContext=currentContext()): LocalDraft {
  const d: LocalDraft = {
    inspectionId: detail.id,
    baseVersion: detail.draftVersion,
    localRev: 0,
    syncedRev: 0,
    syncState: 'idle',
    syncError: null,
    lastSyncedAt: Date.now(),
    savedAt: Date.now(),
    mode: detail.mode,
    scope: detail.scope,
    segments: detail.segments,
    measurements: detail.measurements.map(({ itemKey, seq, value }) => ({ itemKey, seq, value })),
    checklist: detail.checklist ?? [],
    defects: detail.defects.map(({ points: _p, ...x }) => x),
    photos: detail.photos.map((p) => ({
      localId: p.mediaId,
      kind: p.kind,
      checkpointKey: p.checkpointKey,
      defectClientId: p.defectClientId,
      localPath: null,
      thumbPath: null,
      remoteThumb: p.thumbUrl ?? p.url,
      mediaId: p.mediaId,
      status: 'uploaded',
    })),
    remarks: detail.remarks ?? '',
    serverEvaluation: detail.result,
    submitKey: null,
    meta: {
      status: detail.status,
      revision: detail.revision,
      roll: detail.roll,
      task: detail.task,
      spec: detail.spec,
      template: detail.template,
      standards: detail.standards,
    },
  };
  persist(d,c);
  return d;
}

/** 修改本地草稿：立即保存到本机，并安排后台同步 */
export function mutateDraft(id: string, fn: (d: LocalDraft) => void, c:SessionContext=currentContext()): LocalDraft | null {
  if(!sameIdentity(c))return null;
  const d = loadDraft(id,c);
  if (!d) return null;
  fn(d);
  d.localRev += 1;
  if (d.syncState === 'error') d.syncState = 'idle';
  persist(d,c);
  scheduleSync(id,1500,c);
  return d;
}

/** 只更新状态字段，不视为用户修改 */
export function patchDraft(id: string, fn: (d: LocalDraft) => void, c:SessionContext=currentContext()) {
  const d = loadDraft(id,c);
  if (!d) return null;
  fn(d);
  persist(d,c);
  return d;
}

export function toServerDraft(d: LocalDraft): InspectionDraft {
  return {
    baseVersion: d.baseVersion,
    mode: d.mode,
    scope: d.scope,
    segments: d.segments,
    measurements: d.measurements,
    checklist: d.checklist,
    defects: d.defects,
    photos: d.photos
      // 疵点照片必须关联已保存的疵点（新疵点未保存前拍的照片先留在本机）
      .filter((p) => p.status === 'uploaded' && p.mediaId)
      .filter((p) => p.kind !== 'DEFECT' || d.defects.some((x) => x.clientId === p.defectClientId))
      .map((p) => ({ mediaId: p.mediaId!, kind: p.kind, checkpointKey: p.checkpointKey, defectClientId: p.defectClientId })),
    remarks: d.remarks || null,
  };
}

const timers:Record<string,ReturnType<typeof setTimeout>>={};
const inflight:Record<string,Promise<void>|undefined>={};
onContextPause(()=>{Object.values(timers).forEach(clearTimeout);Object.keys(timers).forEach(k=>delete timers[k]);});
export function scheduleSync(id:string,delay=1500,c:SessionContext=currentContext()){
 const k=key(id,c);clearTimeout(timers[k]);
 if(!sameIdentity(c)||contextPhase()!=='ready')return;
 timers[k]=setTimeout(()=>{delete timers[k];void syncDraft(id,c);},delay);
}
export function syncDraft(id:string,c:SessionContext=currentContext(),insideWrite=false):Promise<void>{
 const k=key(id,c);if(inflight[k])return inflight[k]!;
 if(!sameIdentity(c)||(!insideWrite&&contextPhase()!=='ready'))return Promise.resolve();
 const work=async()=>{
  const d=loadDraft(id,c);if(!d||!isDirty(d)||!['DRAFT','RETURNED'].includes(d.meta.status))return;
  const rev=d.localRev;patchDraft(id,x=>{x.syncState='syncing';},c);
  try{
   const r=await requestScoped<{draftVersion:number;evaluation:InspectionEvaluation}>(c,'PUT',`/inspections/${id}/draft`,toServerDraft(d),true,true);
   patchDraft(id,x=>{x.baseVersion=r.draftVersion;x.syncedRev=rev;x.syncState='idle';x.syncError=null;x.lastSyncedAt=Date.now();x.serverEvaluation=r.evaluation;},c);
   const after=loadDraft(id,c);if(after&&isDirty(after))scheduleSync(id,300,c);
  }catch(e){patchDraft(id,x=>{x.syncState=e instanceof ApiError&&e.code==='VERSION_CONFLICT'?'conflict':'error';x.syncError=errorText(e);},c);
   // Real legacy drafts retain the existing offline policy; demo unknown write results require explicit recovery.
   if(c.kind==='real'&&e instanceof ApiError&&e.isNetwork)scheduleSync(id,15000,c);
  }
 };
 const run=(insideWrite?work():withContextWrite(c,work)).catch(e=>{patchDraft(id,x=>{x.syncState='error';x.syncError=errorText(e);},c);});
 inflight[k]=run.finally(()=>{inflight[k]=undefined;});return inflight[k]!;
}
export async function resolveConflictKeepLocal(id:string,c:SessionContext=currentContext()){
 await withContextWrite(c,async()=>{const detail=await requestScoped<InspectionDetail>(c,'GET',`/inspections/${id}`,undefined,true,true);patchDraft(id,x=>{x.baseVersion=detail.draftVersion;x.syncState='idle';x.syncError=null;},c);await syncDraft(id,c,true);});
}
export function scopedDraft(c:SessionContext){return {
 loadDraft:(id:string)=>loadDraft(id,c),removeDraft:(id:string)=>removeDraft(id,c),draftFromServer:(d:InspectionDetail)=>draftFromServer(d,c),
 mutateDraft:(id:string,fn:(d:LocalDraft)=>void)=>mutateDraft(id,fn,c),patchDraft:(id:string,fn:(d:LocalDraft)=>void)=>patchDraft(id,fn,c),
 syncDraft:(id:string,insideWrite=false)=>syncDraft(id,c,insideWrite),resolveConflictKeepLocal:(id:string)=>resolveConflictKeepLocal(id,c),
};}

/** 本机离线预估（与服务端使用同一个评分引擎；提交后以服务端结果为准） */
export function localEvaluation(d: LocalDraft): InspectionEvaluation | null {
  try {
    const std = (s: { versionId: string; name: string; version: number; rules: unknown }) => ({
      versionId: s.versionId,
      name: `${s.name} v${s.version}`,
      rules: standardRulesSchema.parse(s.rules),
    });
    return evaluateInspection({
      scope: d.scope,
      segments: d.segments,
      defects: d.defects,
      measurements: d.measurements,
      checklist: d.checklist,
      templateChecklist: d.meta.template.checklist,
      spec: {
        widthCm: d.meta.spec.widthCm ?? null,
        cuttableWidthCm: d.meta.spec.cuttableWidthCm ?? null,
        gsm: d.meta.spec.gsm ?? null,
        nominalLengthM: d.meta.spec.nominalLengthM ?? null,
      },
      fourPoint: std(d.meta.standards.fourPoint),
      customer: d.meta.standards.customer ? std(d.meta.standards.customer) : null,
    });
  } catch {
    return null;
  }
}

export function syncLabel(d: LocalDraft): { text: string; tone: 'success' | 'warn' | 'danger' | 'gray' } {
  const pendingPhotos = d.photos.filter((p) => p.status !== 'uploaded').length;
  if (d.syncState === 'conflict') return { text: '版本冲突', tone: 'danger' };
  if (d.syncState === 'syncing') return { text: '同步中…', tone: 'gray' };
  if (d.syncState === 'error') return { text: '待同步（已存本机）', tone: 'warn' };
  if (isDirty(d) || pendingPhotos) return { text: pendingPhotos ? `${pendingPhotos} 张照片待上传` : '本机已保存，待同步', tone: 'warn' };
  return { text: '已同步', tone: 'success' };
}
