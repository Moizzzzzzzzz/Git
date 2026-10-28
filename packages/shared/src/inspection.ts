import { z } from 'zod';
import {
  CHECKLIST_STATUSES,
  DEFECT_SEVERITIES,
  INSPECTION_MODES,
  INSPECTION_SCOPES,
  MEDIA_KINDS,
} from './enums';
import { SPEC_FIELDS } from './rules';

const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, '键名只能包含小写字母、数字和下划线，并以字母开头');

/** 检验模板（inspection_templates.content） */
export const templateContentSchema = z
  .object({
    checklist: z
      .array(z.object({ key, label: z.string().min(1).max(100), required: z.boolean().default(true) }))
      .default([]),
    measurements: z
      .array(
        z.object({
          key,
          label: z.string().min(1).max(100),
          unit: z.string().min(1).max(16),
          required: z.boolean().default(true),
          minReadings: z.number().int().min(1).max(20).default(1),
          specField: z.enum(SPEC_FIELDS).optional(),
        }),
      )
      .default([]),
    photoCheckpoints: z
      .array(
        z.object({
          key,
          label: z.string().min(1).max(100),
          required: z.boolean().default(true),
          minPhotos: z.number().int().min(1).max(10).default(1),
        }),
      )
      .default([]),
  })
  .superRefine((v, ctx) => {
    for (const [name, list] of [
      ['检查项', v.checklist],
      ['测量项', v.measurements],
      ['拍照点', v.photoCheckpoints],
    ] as const) {
      const seen = new Set<string>();
      for (const item of list) {
        if (seen.has(item.key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name}键名重复：${item.key}` });
        }
        seen.add(item.key);
      }
    }
  });
export type TemplateContent = z.infer<typeof templateContentSchema>;
export type TemplateContentInput = z.input<typeof templateContentSchema>;

/** 约定的系统测量键：引擎和服务端会识别这些键 */
export const MeasurementKey = {
  WIDTH: 'width',
  EFFECTIVE_WIDTH: 'effective_width',
  GSM: 'gsm',
  ROLL_LENGTH: 'roll_length',
} as const;

export const DEFAULT_TEMPLATE_CONTENT: TemplateContentInput = {
  checklist: [
    { key: 'label_match', label: '吊牌/标签与布卷信息一致', required: true },
    { key: 'color_match', label: '颜色与标样一致', required: true },
    { key: 'hand_feel', label: '手感正常', required: true },
    { key: 'edge_quality', label: '布边平整无破损', required: true },
  ],
  measurements: [
    { key: 'width', label: '门幅', unit: 'cm', required: true, minReadings: 3, specField: 'widthCm' },
    {
      key: 'effective_width',
      label: '有效门幅',
      unit: 'cm',
      required: true,
      minReadings: 3,
      specField: 'cuttableWidthCm',
    },
    { key: 'gsm', label: '克重', unit: 'g/m²', required: true, minReadings: 1, specField: 'gsm' },
    { key: 'roll_length', label: '卷长', unit: 'm', required: true, minReadings: 1, specField: 'nominalLengthM' },
  ],
  photoCheckpoints: [
    { key: 'roll_label', label: '布卷标签', required: true, minPhotos: 1 },
    { key: 'fabric_face', label: '布面整体', required: true, minPhotos: 1 },
    { key: 'color_compare', label: '对色', required: false, minPhotos: 1 },
  ],
};

const meters = z.number().finite().min(0).max(100000);
const cm = z.number().finite().min(0).max(100000);

export const draftSegmentSchema = z
  .object({ startM: meters, endM: meters })
  .refine((s) => s.endM > s.startM, { message: '区段结束米数必须大于开始米数' });

export const draftDefectSchema = z.object({
  clientId: z.string().uuid(),
  defectTypeCode: z.string().min(1).max(32),
  lengthCm: cm.positive(),
  widthCm: cm.optional().nullable(),
  positionM: meters,
  widthPositionCm: cm.optional().nullable(),
  severity: z.enum(DEFECT_SEVERITIES),
  remark: z.string().max(500).optional().nullable(),
});
export type DraftDefect = z.infer<typeof draftDefectSchema>;

export const draftMeasurementSchema = z.object({
  itemKey: z.string().min(1).max(64),
  seq: z.number().int().min(1).max(50),
  value: z.number().finite(),
  positionM: meters.optional().nullable(),
});
export type DraftMeasurement = z.infer<typeof draftMeasurementSchema>;

export const draftChecklistSchema = z.object({
  key: z.string().min(1).max(64),
  status: z.enum(CHECKLIST_STATUSES),
  note: z.string().max(300).optional().nullable(),
});

export const draftPhotoSchema = z.object({
  mediaId: z.string().uuid(),
  kind: z.enum(MEDIA_KINDS),
  checkpointKey: z.string().max(64).optional().nullable(),
  defectClientId: z.string().uuid().optional().nullable(),
});
export type DraftPhoto = z.infer<typeof draftPhotoSchema>;

export const inspectionDraftSchema = z
  .object({
    baseVersion: z.number().int().min(0),
    mode: z.enum(INSPECTION_MODES),
    scope: z.enum(INSPECTION_SCOPES),
    segments: z.array(draftSegmentSchema).max(200),
    measurements: z.array(draftMeasurementSchema).max(500),
    checklist: z.array(draftChecklistSchema).max(200),
    defects: z.array(draftDefectSchema).max(1000),
    photos: z.array(draftPhotoSchema).max(500),
    remarks: z.string().max(2000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const sorted = [...v.segments].sort((a, b) => a.startM - b.startM);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startM < sorted[i - 1].endM) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '检验区段不能重叠', path: ['segments'] });
        break;
      }
    }
    const ids = new Set<string>();
    for (const d of v.defects) {
      if (ids.has(d.clientId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '疵点 clientId 重复', path: ['defects'] });
      }
      ids.add(d.clientId);
    }
    const mKeys = new Set<string>();
    for (const m of v.measurements) {
      const k = `${m.itemKey}#${m.seq}`;
      if (mKeys.has(k)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `测量读数重复：${k}`, path: ['measurements'] });
      }
      mKeys.add(k);
    }
    for (const p of v.photos) {
      if (p.kind === 'CHECKPOINT' && !p.checkpointKey) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '检查点照片必须指定检查点', path: ['photos'] });
      }
      if (p.kind === 'DEFECT' && (!p.defectClientId || !ids.has(p.defectClientId))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '疵点照片必须关联存在的疵点', path: ['photos'] });
      }
    }
  });
export type InspectionDraft = z.infer<typeof inspectionDraftSchema>;

export const startInspectionSchema = z.object({
  taskRollId: z.string().uuid(),
  mode: z.enum(INSPECTION_MODES),
  scope: z.enum(INSPECTION_SCOPES),
});

export const submitInspectionSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  draftVersion: z.number().int().min(1),
});

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN', 'REJECT']),
    revision: z.number().int().min(1),
    comment: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.comment && v.comment.length >= 2), {
    message: '退回或判定不合格时必须填写原因',
    path: ['comment'],
  });

export const uploadIntentSchema = z.object({
  inspectionId: z.string().uuid(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  withThumbnail: z.boolean().default(true),
});
