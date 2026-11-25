import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@fabricqc/shared';
import type { z } from 'zod';
import type { uploadIntentSchema } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import { StorageAdapter } from './storage.adapter';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

export interface MediaUrls {
  url: string;
  thumbUrl: string | null;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageAdapter,
    private readonly config: AppConfig,
  ) {}

  /** 只有检验的质检员本人、且检验处于可编辑状态时才能上传 */
  private async editableInspection(actor: Actor, inspectionId: string, tx: Tx) {
    const ref = await tx.rollInspection.findUnique({ where: { id: inspectionId }, select: { taskId: true } });
    if (!ref) throw AppError.notFound('检验记录');
    await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${ref.taskId}::uuid FOR UPDATE`;
    const i = await tx.rollInspection.findUnique({ where: { id: inspectionId }, include: { task: { include: { delivery: true } } } });
    if (!i) throw AppError.notFound('检验记录');
    if (i.inspectorId !== actor.userId || (i.task.origin === 'BUSINESS' && i.task.assigneeId !== actor.userId)) throw AppError.forbidden('只能为当前分配给自己的检验上传照片');
    if (i.task.origin === 'BUSINESS' && i.task.delivery) throw AppError.invalidState('整单已交付，不能上传照片');
    if (i.status !== 'DRAFT' && i.status !== 'RETURNED') throw AppError.invalidState('检验已提交，不能再上传照片');
    return i;
  }

  async createUploadIntent(actor: Actor, d: z.infer<typeof uploadIntentSchema>) {
    return this.prisma.$transaction(async (tx) => {
    await this.editableInspection(actor, d.inspectionId, tx);
    if (!this.storage.configured) {
      throw AppError.of(ErrorCode.STORAGE_NOT_CONFIGURED, '服务器未配置图片存储，暂不能上传照片', 503);
    }
    const now = new Date();
    const prefix = `inspections/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${d.inspectionId}`;
    const media = await tx.mediaAsset.create({
      data: {
        provider: this.storage.provider,
        bucket: this.storage.bucket,
        objectKey: `pending/${crypto.randomUUID()}`,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        inspectionId: d.inspectionId,
        uploadedById: actor.userId,
      },
    });
    const objectKey = `${prefix}/${media.id}.${EXT[d.mimeType]}`;
    const thumbKey = d.withThumbnail ? `${prefix}/${media.id}_thumb.jpg` : null;
    await tx.mediaAsset.update({ where: { id: media.id }, data: { objectKey, thumbKey } });
    const ttl = this.config.env.UPLOAD_URL_TTL_SECONDS;
    return {
      mediaId: media.id,
      expiresIn: ttl,
      upload: { method: 'PUT', url: await this.storage.presignPut(objectKey, d.mimeType, ttl), headers: { 'Content-Type': d.mimeType } },
      thumbUpload: thumbKey
        ? { method: 'PUT', url: await this.storage.presignPut(thumbKey, 'image/jpeg', ttl), headers: { 'Content-Type': 'image/jpeg' } }
        : null,
    };
    });
  }

  /** 上传完成确认：服务端向存储 HEAD 校验对象确实存在且大小合规 */
  async confirm(actor: Actor, mediaId: string) {
    return this.prisma.$transaction(async (tx) => {
    const m = await tx.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!m) throw AppError.notFound('照片');
    if (m.uploadedById !== actor.userId) throw AppError.forbidden();
    if (m.inspectionId) {
      const ref = await tx.rollInspection.findUnique({ where: { id: m.inspectionId }, select: { taskId: true } });
      if (!ref) throw AppError.notFound('检验记录');
      await tx.$queryRaw`SELECT id FROM qc_tasks WHERE id = ${ref.taskId}::uuid FOR UPDATE`;
      const i = await tx.rollInspection.findUniqueOrThrow({ where: { id: m.inspectionId }, include: { task: { include: { delivery: true } } } });
      if (i.inspectorId !== actor.userId || (i.task.origin === 'BUSINESS' && i.task.assigneeId !== actor.userId)) throw AppError.forbidden('任务已改派');
      if (i.task.origin === 'BUSINESS' && i.task.delivery) throw AppError.invalidState('整单已交付，不能确认照片');
      if (m.status !== 'UPLOADED' && i.status !== 'DRAFT' && i.status !== 'RETURNED') throw AppError.invalidState('检验已提交，不能确认照片');
    }
    if (m.status === 'UPLOADED') return { mediaId: m.id, status: m.status, sizeBytes: m.sizeBytes };
    const head = await this.storage.head(m.objectKey);
    if (!head) throw AppError.of(ErrorCode.STORAGE_ERROR, '照片尚未上传成功，请重试上传', 409);
    if (head.sizeBytes <= 0 || head.sizeBytes > MAX_BYTES) {
      await this.storage.delete(m.objectKey).catch(() => undefined);
      await tx.mediaAsset.update({ where: { id: m.id }, data: { status: 'FAILED' } });
      throw AppError.badRequest('照片大小不符合要求（最大 20MB）');
    }
    if (m.thumbKey) {
      const th = await this.storage.head(m.thumbKey);
      if (!th) throw AppError.of(ErrorCode.STORAGE_ERROR, '缩略图尚未上传成功，请重试上传', 409);
      if (th.sizeBytes > MAX_THUMB_BYTES) throw AppError.badRequest('缩略图过大');
    }
    const updated = await tx.mediaAsset.update({
      where: { id: m.id },
      data: { status: 'UPLOADED', sizeBytes: head.sizeBytes, confirmedAt: new Date() },
    });
    return { mediaId: updated.id, status: updated.status, sizeBytes: updated.sizeBytes };
    });
  }

  /** 提交修订前复制为客户端无法取得 PUT 链接的稳定对象。失败不清理，避免误删并发已引用对象。 */
  async freezeForRevision(inspectionId: string, revision: number, photos: { mediaId: string; objectKey: string; thumbKey: string | null }[]) {
    if (photos.length && !this.storage.configured) throw AppError.of(ErrorCode.STORAGE_NOT_CONFIGURED, '服务器未配置图片存储', 503);
    return Promise.all(photos.map(async (photo) => {
      const prefix = `frozen-inspections/${inspectionId}/${revision}/${crypto.randomUUID()}`;
      const objectKey = `${prefix}/original`;
      const thumbKey = photo.thumbKey ? `${prefix}/thumbnail` : null;
      await this.storage.copy(photo.objectKey, objectKey);
      if (!(await this.storage.head(objectKey))?.sizeBytes) throw AppError.of(ErrorCode.STORAGE_ERROR, '照片冻结失败，请重试', 502);
      if (thumbKey && photo.thumbKey) {
        await this.storage.copy(photo.thumbKey, thumbKey);
        if (!(await this.storage.head(thumbKey))?.sizeBytes) throw AppError.of(ErrorCode.STORAGE_ERROR, '缩略图冻结失败，请重试', 502);
      }
      return { mediaId: photo.mediaId, objectKey, thumbKey };
    }));
  }

  /** 生成短时效查看链接；调用方负责权限校验 */
  async urls(m: { objectKey: string; thumbKey: string | null }): Promise<MediaUrls> {
    if (!this.storage.configured) return { url: '', thumbUrl: null };
    const ttl = this.config.env.VIEW_URL_TTL_SECONDS;
    return {
      url: await this.storage.presignGet(m.objectKey, ttl),
      thumbUrl: m.thumbKey ? await this.storage.presignGet(m.thumbKey, ttl) : null,
    };
  }
}
