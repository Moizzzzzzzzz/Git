import Taro from '@tarojs/taro';
import type { MediaKind } from '@fabricqc/shared';
import { api, ApiError, errorText } from './api';
import { loadDraft, mutateDraft, patchDraft, type LocalPhoto } from './draft';
import { uuid } from './uuid';

interface UploadIntent {
  mediaId: string;
  upload: { url: string; headers: Record<string, string> };
  thumbUpload: { url: string; headers: Record<string, string> } | null;
}

function persistFile(tempPath: string): string {
  const fs = Taro.getFileSystemManager();
  const ext = tempPath.split('.').pop() || 'jpg';
  const dest = `${Taro.env.USER_DATA_PATH}/fqc_${uuid()}.${ext}`;
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
): Promise<LocalPhoto | null> {
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
    localPath: persistFile(file.tempFilePath),
    thumbPath: persistFile(thumbTemp),
    remoteThumb: null,
    mediaId: null,
    status: 'pending',
  };
  mutateDraft(inspectionId, (d) => {
    d.photos.push(photo);
  });
  void uploadPending(inspectionId);
  return photo;
}

async function putFile(url: string, path: string, contentType: string) {
  const data = Taro.getFileSystemManager().readFileSync(path) as ArrayBuffer;
  const r = await Taro.request({ url, method: 'PUT', data, header: { 'Content-Type': contentType }, timeout: 120000 });
  if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`上传失败（${r.statusCode}）`);
}

const uploading = new Set<string>();

async function uploadOne(inspectionId: string, p: LocalPhoto) {
  if (!p.localPath) return;
  uploading.add(p.localId);
  patchDraft(inspectionId, (d) => {
    const x = d.photos.find((y) => y.localId === p.localId);
    if (x) {
      x.status = 'uploading';
      x.error = undefined;
    }
  });
  try {
    const fs = Taro.getFileSystemManager();
    const size = (fs.statSync(p.localPath) as Taro.Stats).size;
    const mime = mimeOf(p.localPath);
    const intent = await api.post<UploadIntent>('/media/upload-intents', {
      inspectionId,
      mimeType: mime,
      sizeBytes: size,
      withThumbnail: !!p.thumbPath,
    });
    await putFile(intent.upload.url, p.localPath, mime);
    if (intent.thumbUpload && p.thumbPath) await putFile(intent.thumbUpload.url, p.thumbPath, 'image/jpeg');
    await api.post(`/media/${intent.mediaId}/confirm`);
    // 照片关联属于用户数据变化，需要同步草稿
    mutateDraft(inspectionId, (d) => {
      const x = d.photos.find((y) => y.localId === p.localId);
      if (x) {
        x.mediaId = intent.mediaId;
        x.status = 'uploaded';
      }
    });
  } catch (e) {
    patchDraft(inspectionId, (d) => {
      const x = d.photos.find((y) => y.localId === p.localId);
      if (x) {
        x.status = 'failed';
        x.error = e instanceof ApiError ? e.message : errorText(e);
      }
    });
  } finally {
    uploading.delete(p.localId);
  }
}

/** 上传所有待上传 / 失败的照片（顺序执行，避免弱网下并发拥塞） */
export async function uploadPending(inspectionId: string) {
  const d = loadDraft(inspectionId);
  if (!d) return;
  for (const p of d.photos) {
    if ((p.status === 'pending' || p.status === 'failed') && !uploading.has(p.localId)) {
      await uploadOne(inspectionId, p);
    }
  }
}

export function removePhoto(inspectionId: string, localId: string) {
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
  });
}

export function photoSrc(p: LocalPhoto) {
  return p.thumbPath ?? p.localPath ?? p.remoteThumb ?? '';
}
