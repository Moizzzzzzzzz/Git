import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | null;
}

/**
 * 对象存储抽象。业务代码只依赖此接口，数据库只保存对象键（不保存服务器本地路径）。
 * 以后切换存储只需新增实现或修改环境变量。
 */
export abstract class StorageAdapter {
  abstract readonly provider: string;
  abstract readonly bucket: string;
  abstract get configured(): boolean;
  abstract presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string>;
  abstract presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** 对象不存在返回 null */
  abstract head(key: string): Promise<ObjectHead | null>;
  abstract delete(key: string): Promise<void>;
}

/** S3 兼容实现：腾讯云 COS（S3 兼容端点）与 MinIO */
@Injectable()
export class S3StorageAdapter extends StorageAdapter {
  readonly provider: string;
  readonly bucket: string;
  private readonly internal: S3Client | null;
  private readonly publicClient: S3Client | null;

  constructor(private readonly config: AppConfig) {
    super();
    const e = config.env;
    this.provider = e.STORAGE_PROVIDER;
    this.bucket = e.STORAGE_BUCKET ?? '';
    if (!config.storageConfigured) {
      this.internal = null;
      this.publicClient = null;
      return;
    }
    const make = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: e.STORAGE_REGION,
        forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
        credentials: { accessKeyId: e.STORAGE_ACCESS_KEY_ID!, secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY! },
        // 预签名 URL 不附加 CRC 校验参数，兼容小程序直传与 COS
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    this.internal = make(e.STORAGE_ENDPOINT!);
    this.publicClient = make(e.STORAGE_PUBLIC_ENDPOINT ?? e.STORAGE_ENDPOINT!);
  }

  get configured() {
    return this.internal !== null;
  }

  private clients() {
    if (!this.internal || !this.publicClient) {
      throw AppError.of(ErrorCode.STORAGE_NOT_CONFIGURED, '服务器未配置图片存储，暂不能上传照片', 503);
    }
    return { internal: this.internal, pub: this.publicClient };
  }

  presignPut(key: string, contentType: string, ttlSeconds: number) {
    const { pub } = this.clients();
    return getSignedUrl(pub, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), {
      expiresIn: ttlSeconds,
    });
  }

  presignGet(key: string, ttlSeconds: number) {
    const { pub } = this.clients();
    return getSignedUrl(pub, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    const { internal } = this.clients();
    try {
      const r = await internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw AppError.of(ErrorCode.STORAGE_ERROR, '访问图片存储失败，请稍后重试', 502);
    }
  }

  async delete(key: string) {
    const { internal } = this.clients();
    await internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
