import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@fabricqc/shared';
import type { z } from 'zod';
import type { uploadIntentSchema } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
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
  private async editableInspection(actor: Actor, inspectionId: string) {
    const i = await this.prisma.rollInspection.findUnique({ where: { id: inspectionId } });
    if (!i) throw AppError.notFound('检验记录');
    if (i.inspectorId !== actor.userId) throw AppError.forbidden('只能为自己的检验上传照片');
    if (i.status !== 'DRAFT' && i.status !== 'RETURNED') throw AppError.invalidState('检验已提交，不能再上传照片');
    return i;
  }

  async createUploadIntent(actor: Actor, d: z.infer<typeof uploadIntentSchema>) {
    await this.editableInspection(actor, d.inspectionId);
    if (!this.storage.configured) {
      throw AppError.of(ErrorCode.STORAGE_NOT_CONFIGURED, '服务器未配置图片存储，暂不能上传照片', 503);
    }
    const now = new Date();
    const prefix = `inspections/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${d.inspectionId}`;
    const media = await this.prisma.mediaAsset.create({
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
    await this.prisma.mediaAsset.update({ where: { id: media.id }, data: { objectKey, thumbKey } });
    const ttl = this.config.env.UPLOAD_URL_TTL_SECONDS;
    return {
      mediaId: media.id,
      expiresIn: ttl,
      upload: { method: 'PUT', url: await this.storage.presignPut(objectKey, d.mimeType, ttl), headers: { 'Content-Type': d.mimeType } },
      thumbUpload: thumbKey
        ? { method: 'PUT', url: await this.storage.presignPut(thumbKey, 'image/jpeg', ttl), headers: { 'Content-Type': 'image/jpeg' } }
        : null,
    };
  }

  /** 上传完成确认：服务端向存储 HEAD 校验对象确实存在且大小合规 */
  async confirm(actor: Actor, mediaId: string) {
    const m = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!m) throw AppError.notFound('照片');
    if (m.uploadedById !== actor.userId) throw AppError.forbidden();
    if (m.status === 'UPLOADED') return { mediaId: m.id, status: m.status, sizeBytes: m.sizeBytes };
    const head = await this.storage.head(m.objectKey);
    if (!head) throw AppError.of(ErrorCode.STORAGE_ERROR, '照片尚未上传成功，请重试上传', 409);
    if (head.sizeBytes <= 0 || head.sizeBytes > MAX_BYTES) {
      await this.storage.delete(m.objectKey).catch(() => undefined);
      await this.prisma.mediaAsset.update({ where: { id: m.id }, data: { status: 'FAILED' } });
      throw AppError.badRequest('照片大小不符合要求（最大 20MB）');
    }
    if (m.thumbKey) {
      const th = await this.storage.head(m.thumbKey);
      if (!th) throw AppError.of(ErrorCode.STORAGE_ERROR, '缩略图尚未上传成功，请重试上传', 409);
      if (th.sizeBytes > MAX_THUMB_BYTES) throw AppError.badRequest('缩略图过大');
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: m.id },
      data: { status: 'UPLOADED', sizeBytes: head.sizeBytes, confirmedAt: new Date() },
    });
    return { mediaId: updated.id, status: updated.status, sizeBytes: updated.sizeBytes };
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
