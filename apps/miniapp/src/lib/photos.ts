import {DEMO_MEDIA_PREFIX} from './config';
import Taro from '@tarojs/taro';
import type { MediaKind } from '@fabricqc/shared';
import { requestScoped, ApiError, errorText, toastError } from './api';
import { currentContext, contextScope, assertIdentity, type SessionContext } from './session-context';
import { withContextWrite } from './demo-session';
import { loadDraft, mutateDraft, patchDraft, type LocalPhoto } from './draft';
import { uuid } from './uuid';

interface UploadIntent {
  mediaId: string;
  upload: { url: string; headers: Record<string, string> };
  thumbUpload: { url: string; headers: Record<string, string> } | null;
}

function persistFile(tempPath: string,c:SessionContext): string {
  const fs = Taro.getFileSystemManager();
  const ext = tempPath.split('.').pop() || 'jpg';
  const dest = `${Taro.env.USER_DATA_PATH}/fqc_${c.kind}_${uuid()}.${ext}`;
  fs.saveFileSync(tempPath, dest);
  return dest;
}

function mimeOf(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

/** 拍照或从相册选择；照片立即保存到本机，再后台上传 */
export async function takePhoto(
  inspectionId: string,
  target: { kind: MediaKind; checkpointKey?: string | null; defectClientId?: string | null },
  source: 'camera' | 'album' = 'camera',
  c:SessionContext=currentContext(),
): Promise<LocalPhoto | null> {
 try{return await withContextWrite(c,async()=>{
  let res: Taro.chooseMedia.SuccessCallbackResult;
  try {
    res = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [source], sizeType: ['original'], camera: 'back' });
  } catch {
    return null; // 用户取消
  }
  const file = res.tempFiles[0];
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) {
    void Taro.showToast({ title: '照片超过 20MB', icon: 'none' });
    return null;
  }
  // 缩略图：客户端压缩，与原图一起直传（不依赖云厂商图片处理）
  let thumbTemp = file.tempFilePath;
  try {
    const c = await Taro.compressImage({ src: file.tempFilePath, quality: 40, compressedWidth: 480 } as Taro.compressImage.Option);
    thumbTemp = c.tempFilePath;
  } catch {
    /* 低版本基础库不支持时直接用原图作为缩略图 */
  }
  const photo: LocalPhoto = {
    localId: uuid(),
    kind: target.kind,
    checkpointKey: target.checkpointKey ?? null,
    defectClientId: target.defectClientId ?? null,
    localPath: persistFile(file.tempFilePath,c),
    thumbPath: persistFile(thumbTemp,c),
    remoteThumb: null,
    mediaId: null,
    status: 'pending',
  };
  mutateDraft(inspectionId, (d) => {
    d.photos.push(photo);
  },c);
  await uploadPending(inspectionId,c,true);
  return photo;
 });}catch(e){toastError(e);return null;}
}

async function putFile(url: string, path: string, contentType: string,c:SessionContext) {
  if(c.kind==='demo'&&(!DEMO_MEDIA_PREFIX||!url.startsWith(DEMO_MEDIA_PREFIX)||url.slice(DEMO_MEDIA_PREFIX.length).split('?')[0].split('/').some(x=>x==='..'||/%2e|%2f|%5c/i.test(x))))throw new ApiError(403,'DEMO_MEDIA_TARGET','拒绝非演示照片存储地址');
  const data = Taro.getFileSystemManager().readFileSync(path) as ArrayBuffer;
  const r = await Taro.request({ url, method: 'PUT', data, header: { 'Content-Type': contentType }, timeout: 120000 });
  if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`上传失败（${r.statusCode}）`);
}

const uploading = new Set<string>();

async function uploadOne(inspectionId: string, p: LocalPhoto,c:SessionContext) {
  if (!p.localPath) return;
  const job=`${contextScope(c)}:${p.localId}`;uploading.add(job);
  patchDraft(inspectionId, (d) => {
    const x = d.photos.find((y) => y.localId === p.localId);
    if (x) {
      x.status = 'uploading';
      x.error = undefined;
    }
  },c);
  try {
    const fs = Taro.getFileSystemManager();
    const size = (fs.statSync(p.localPath) as Taro.Stats).size;
    const mime = mimeOf(p.localPath);
    const intent = await requestScoped<UploadIntent>(c,'POST','/media/upload-intents', {
      inspectionId,
      mimeType: mime,
      sizeBytes: size,
      withThumbnail: !!p.thumbPath,
    },true,true);
    await putFile(intent.upload.url, p.localPath, mime,c);
    if (intent.thumbUpload && p.thumbPath) await putFile(intent.thumbUpload.url, p.thumbPath, 'image/jpeg',c);
    await requestScoped(c,'POST',`/media/${intent.mediaId}/confirm`,{},true,true);
    // 照片关联属于用户数据变化，需要同步草稿
    mutateDraft(inspectionId, (d) => {
      const x = d.photos.find((y) => y.localId === p.localId);
      if (x) {
        x.mediaId = intent.mediaId;
        x.status = 'uploaded';
      }
    },c);
  } catch (e) {
    patchDraft(inspectionId, (d) => {
      const x = d.photos.find((y) => y.localId === p.localId);
      if (x) {
        x.status = 'failed';
        x.error = e instanceof ApiError ? e.message : errorText(e);
      }
    },c);
  } finally {
    uploading.delete(job);
  }
}

/** 上传所有待上传 / 失败的照片（顺序执行，避免弱网下并发拥塞） */
export async function uploadPending(inspectionId:string,c:SessionContext=currentContext(),insideWrite=false,manualRetry=false){
 const work=async()=>{assertIdentity(c);const d=loadDraft(inspectionId,c);if(!d)return;
  for(const p of d.photos){if((p.status==='pending'||(p.status==='failed'&&(c.kind==='real'||manualRetry)))&&!uploading.has(`${contextScope(c)}:${p.localId}`))await uploadOne(inspectionId,p,c);}
 };
 if(insideWrite)return work();
 try{await withContextWrite(c,work);}catch(e){toastError(e);}
}

export function removePhoto(inspectionId: string, localId: string,c:SessionContext=currentContext()) {
  mutateDraft(inspectionId, (d) => {
    const p = d.photos.find((x) => x.localId === localId);
    d.photos = d.photos.filter((x) => x.localId !== localId);
    for (const f of [p?.localPath, p?.thumbPath]) {
      if (f) {
        try {
          Taro.getFileSystemManager().unlinkSync(f);
        } catch {
          /* ignore */
        }
      }
    }
  },c);
}

export function photoSrc(p: LocalPhoto) {
  return p.thumbPath ?? p.localPath ?? p.remoteThumb ?? '';
}

export function scopedPhotos(c:SessionContext){return {
 takePhoto:(id:string,target:{kind:MediaKind;checkpointKey?:string|null;defectClientId?:string|null},source:'camera'|'album'='camera')=>takePhoto(id,target,source,c),
 uploadPending:(id:string,insideWrite=false,manualRetry=false)=>uploadPending(id,c,insideWrite,manualRetry),
 removePhoto:(id:string,localId:string)=>removePhoto(id,localId,c),
};}
