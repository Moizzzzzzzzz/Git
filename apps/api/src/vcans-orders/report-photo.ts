import sharp from 'sharp';
import { AppError } from '../common/app-error';

type FrozenDefect = { clientId?: string; defectTypeCode?: string; positionM?: number };
type FrozenPhoto = { kind?: string | null; checkpointKey?: string | null; defectClientId?: string | null };
type FrozenTemplate = { photoCheckpoints?: { key?: string; label?: string }[] } | null;
/** Creates a bounded PDF derivative in memory; frozen original bytes are never modified. */
export async function prepareReportPhoto(bytes: Buffer, photo: FrozenPhoto, defects: FrozenDefect[], names: Record<string, string>, template?: FrozenTemplate) {
  try {
    const input = sharp(bytes, { limitInputPixels: 150_000_000, failOn: 'warning', pages: 1, autoOrient: true });
    const metadata = await input.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw AppError.invalidState('报告照片格式不受支持');
    if ((metadata.pages ?? 1) > 1) throw AppError.invalidState('动态图片不能用于报告，请提供静态照片');
    const converted = await input.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
    if (converted.length > 12 * 1024 * 1024) throw AppError.invalidState('报告照片派生图过大');
    const defect = photo.defectClientId ? defects.find((item) => item.clientId === photo.defectClientId) : undefined;
    if (photo.defectClientId && !defect) throw AppError.invalidState('报告照片关联的冻结疵点不存在');
    const code = defect?.defectTypeCode;
    const label = photo.kind === 'CHECKPOINT' ? template?.photoCheckpoints?.find((item) => item.key === photo.checkpointKey)?.label?.trim() : undefined;
    const caption = photo.kind === 'CHECKPOINT' ? (label || '检查项照片') : !defect ? '检验照片' : undefined;
    return { bytes: converted, defectName: code ? names[code] ?? code : undefined, positionM: defect?.positionM ?? null, caption };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.invalidState('报告照片无法解码或超过安全尺寸，请检查原始照片');
  }
}
