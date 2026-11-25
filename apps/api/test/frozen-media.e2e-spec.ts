import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { S3StorageAdapter } from '../src/media/storage.adapter';
import { MediaService } from '../src/media/media.service';
import { AppConfig } from '../src/config/app-config';
import { loadEnv } from '../src/config/env';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('稳定照片存储（独立 MinIO）', () => {
  it('原图和缩略图冻结后，旧上传链接重放不改变冻结副本', async () => {
    const env = loadEnv();
    expect(new URL(env.STORAGE_ENDPOINT!).hostname).toBe('127.0.0.1');
    const config = new AppConfig(env);
    const adapter = new S3StorageAdapter(config);
    const service = new MediaService({} as PrismaService, adapter, config);
    const id = randomUUID();
    const original = `tests/${id}/original`;
    const thumbnail = `tests/${id}/thumbnail`;
    const client = new S3Client({ endpoint: env.STORAGE_ENDPOINT, region: env.STORAGE_REGION, forcePathStyle: true, credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY! }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
    const read = async (key: string) => (await client.send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET!, Key: key }))).Body!.transformToString();
    const oldOriginalPut = await adapter.presignPut(original, 'image/jpeg', 600);
    const oldThumbPut = await adapter.presignPut(thumbnail, 'image/jpeg', 600);
    const upload = async (url: string, body: string) => { const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body }); expect(response.status).toBe(200); };
    await upload(oldOriginalPut, 'original-before');
    await upload(oldThumbPut, 'thumbnail-before');
    const [frozen] = await service.freezeForRevision(id, 1, [{ mediaId: id, objectKey: original, thumbKey: thumbnail }]);
    await upload(oldOriginalPut, 'original-after');
    await upload(oldThumbPut, 'thumbnail-after');
    expect(await read(frozen.objectKey)).toBe('original-before');
    expect(await read(frozen.thumbKey!)).toBe('thumbnail-before');
  });
});
