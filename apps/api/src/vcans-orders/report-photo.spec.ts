import sharp from 'sharp';
import { prepareReportPhoto } from './report-photo';
it('WebP在不改变原始字节的情况下派生PDF兼容图并保留同次疵点位置', async () => {
  const original = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#aabbcc' } }).webp().toBuffer();
  const before = Buffer.from(original);
  const result = await prepareReportPhoto(original, { defectClientId: 'd1' }, [{ clientId: 'd1', defectTypeCode: 'SLUB', positionM: 12.3 }], { SLUB: '粗节' });
  expect(original).toEqual(before);
  expect((await sharp(result.bytes).metadata()).format).toBe('jpeg');
  expect(result).toMatchObject({ defectName: '粗节', positionM: 12.3 });
});
it('检查项使用该次冻结模板中的名称，缺失时不猜名称或米位', async () => {
  const original = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
  const photo = { kind: 'CHECKPOINT', checkpointKey: 'roll_label' };
  const first = await prepareReportPhoto(original, photo, [], {}, { photoCheckpoints: [{ key: 'roll_label', label: '布卷标签' }] });
  const second = await prepareReportPhoto(original, photo, [], {}, { photoCheckpoints: [{ key: 'roll_label', label: '另一版标签名称' }] });
  const old = await prepareReportPhoto(original, photo, [], {});
  expect(first).toMatchObject({ caption: '布卷标签', positionM: null });
  expect(second.caption).toBe('另一版标签名称');
  expect(old).toMatchObject({ caption: '检查项照片', positionM: null });
});
it('已允许的10至20MiB JPEG可以生成有界派生图', async () => {
  const { randomBytes } = await import('node:crypto');
  const width = 2500, height = 2500;
  const original = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  expect(original.length).toBeGreaterThan(10 * 1024 * 1024);
  expect(original.length).toBeLessThanOrEqual(20 * 1024 * 1024);
  const result = await prepareReportPhoto(original, {}, [], {});
  expect(result.bytes.length).toBeLessThanOrEqual(12 * 1024 * 1024);
  expect((await sharp(result.bytes).metadata()).format).toBe('jpeg');
});
