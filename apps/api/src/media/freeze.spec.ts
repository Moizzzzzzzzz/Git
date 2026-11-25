import { MediaService } from './media.service';
import type { StorageAdapter } from './storage.adapter';
import type { AppConfig } from '../config/app-config';
import type { PrismaService } from '../prisma/prisma.service';

describe('提交照片冻结', () => {
  it('复制原图与缩略图至服务端专用名称并保留引用', async () => {
    const copied: { source: string; dest: string }[] = [];
    const storage = { configured: true, copy: async (source: string, dest: string) => { copied.push({ source, dest }); }, head: async () => ({ sizeBytes: 4, contentType: 'image/jpeg' }) } as unknown as StorageAdapter;
    const service = new MediaService({} as PrismaService, storage, {} as AppConfig);
    const frozen = await service.freezeForRevision('inspection-id', 1, [{ mediaId: 'photo-id', objectKey: 'inspections/original.jpg', thumbKey: 'inspections/thumb.jpg' }]);
    expect(copied).toHaveLength(2);
    expect(copied[0].source).toBe('inspections/original.jpg');
    expect(copied[1].source).toBe('inspections/thumb.jpg');
    expect(frozen[0].objectKey).toMatch(/^frozen-inspections\/inspection-id\/1\//);
    expect(frozen[0].thumbKey).toMatch(/^frozen-inspections\/inspection-id\/1\//);
    expect(frozen[0].objectKey).not.toBe(frozen[0].thumbKey);
  });
});
