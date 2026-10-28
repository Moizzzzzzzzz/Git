import { z } from 'zod';
import { DEFECT_SEVERITIES, INSPECTION_SCOPES } from './enums';

/**
 * 质量标准规则（standard_versions.rules 的 JSON 结构）。
 * 四分制标准与客户标准共用同一结构：四分制标准必须包含 fourPoint 段；
 * 客户标准通常只包含阈值、禁止疵点、测量限值等硬性要求。
 */

const positive = z.number().finite().positive();
const nonNegative = z.number().finite().min(0);

/** 尺寸分档：疵点尺寸 ≤ maxCm 时扣 points 分；最后一档 maxCm 为 null 表示无上限 */
export const sizeBandSchema = z.object({
  maxCm: positive.nullable(),
  points: nonNegative,
});
export type SizeBand = z.infer<typeof sizeBandSchema>;

function bandsAreOrdered(bands: SizeBand[]): boolean {
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const isLast = i === bands.length - 1;
    if (b.maxCm === null && !isLast) return false;
    if (i > 0) {
      const prev = bands[i - 1].maxCm;
      if (prev === null || (b.maxCm !== null && b.maxCm <= prev)) return false;
    }
  }
  return bands.length > 0 && bands[bands.length - 1].maxCm === null;
}

const sizeBandsSchema = z
  .array(sizeBandSchema)
  .min(1)
  .refine(bandsAreOrdered, { message: '尺寸分档必须按上限递增排列，且最后一档上限为空（无上限）' });

export const specialDefectRuleSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('FIXED_POINTS'),
    defectTypeCodes: z.array(z.string().min(1)).min(1),
    points: nonNegative,
    note: z.string().optional(),
  }),
  z.object({
    mode: z.literal('BY_SIZE'),
    defectTypeCodes: z.array(z.string().min(1)).min(1),
    bands: sizeBandsSchema,
    note: z.string().optional(),
  }),
  z.object({
    /** 连续性疵点：所跨的每个线性单位计 points 分 */
    mode: z.literal('PER_LINEAR_UNIT'),
    defectTypeCodes: z.array(z.string().min(1)).min(1),
    points: nonNegative,
    note: z.string().optional(),
  }),
]);
export type SpecialDefectRule = z.infer<typeof specialDefectRuleSchema>;

export const AreaUnit = { PER_100_SQ_YD: 'PER_100_SQ_YD', PER_100_SQ_M: 'PER_100_SQ_M' } as const;
export type AreaUnit = (typeof AreaUnit)[keyof typeof AreaUnit];

export const fourPointConfigSchema = z.object({
  /** 尺寸取值：LENGTH=疵点长度；MAX_DIMENSION=长宽取大 */
  dimensionBasis: z.enum(['LENGTH', 'MAX_DIMENSION']),
  bands: sizeBandsSchema,
  specialRules: z.array(specialDefectRuleSchema).default([]),
  /** 每个线性单位封顶分数；null 表示不封顶 */
  maxPointsPerLinearUnit: z
    .object({ unitLengthM: positive, maxPoints: positive })
    .nullable(),
  areaUnit: z.enum([AreaUnit.PER_100_SQ_YD, AreaUnit.PER_100_SQ_M]),
});
export type FourPointConfig = z.infer<typeof fourPointConfigSchema>;

export const SpecField = {
  widthCm: 'widthCm',
  cuttableWidthCm: 'cuttableWidthCm',
  gsm: 'gsm',
  nominalLengthM: 'nominalLengthM',
} as const;
export type SpecField = (typeof SpecField)[keyof typeof SpecField];
export const SPEC_FIELDS = ['widthCm', 'cuttableWidthCm', 'gsm', 'nominalLengthM'] as const;

export const measurementLimitSchema = z
  .object({
    itemKey: z.string().min(1),
    label: z.string().min(1),
    /** ABSOLUTE：直接比较 min/max；RELATIVE_TO_SPEC：相对规格值的百分比 */
    mode: z.enum(['ABSOLUTE', 'RELATIVE_TO_SPEC']),
    specField: z.enum(SPEC_FIELDS).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    minPct: z.number().finite().optional(),
    maxPct: z.number().finite().optional(),
    /** EACH：每个读数都要满足；AVG：平均值满足 */
    aggregate: z.enum(['EACH', 'AVG']).default('EACH'),
    required: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'ABSOLUTE' && v.min === undefined && v.max === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.label}：绝对限值至少需要 min 或 max` });
    }
    if (v.mode === 'RELATIVE_TO_SPEC') {
      if (!v.specField) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.label}：需要指定规格字段` });
      if (v.minPct === undefined && v.maxPct === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${v.label}：相对限值至少需要 minPct 或 maxPct` });
      }
    }
  });
export type MeasurementLimit = z.infer<typeof measurementLimitSchema>;

export const standardRulesSchema = z.object({
  schemaVersion: z.literal(1),
  fourPoint: fourPointConfigSchema.optional(),
  thresholds: z
    .object({
      /** 标准化得分上限（单位由四分制标准 areaUnit 决定） */
      maxNormalizedPoints: nonNegative.optional(),
      maxTotalPoints: nonNegative.optional(),
      maxDefectCount: z.number().int().min(0).optional(),
    })
    .default({}),
  forbiddenDefectTypes: z.array(z.string().min(1)).default([]),
  maxDefectCountByType: z.record(z.string(), z.number().int().min(0)).default({}),
  /** 出现该严重度及以上的疵点即判不合格；null 表示不按严重度否决 */
  failOnSeverity: z.enum(DEFECT_SEVERITIES).nullable().default(null),
  measurementLimits: z.array(measurementLimitSchema).default([]),
  /** 要求的检验范围；非该范围的检验结论为"无法判定" */
  requiredScope: z.enum(INSPECTION_SCOPES).nullable().default(null),
  /** 每个疵点是否必须有照片 */
  requireDefectPhoto: z.boolean().default(true),
});
export type StandardRules = z.infer<typeof standardRulesSchema>;
export type StandardRulesInput = z.input<typeof standardRulesSchema>;

/**
 * 【开发默认值】参照 ASTM D5430 常见口径的四分制规则，仅用于开发与演示。
 * 工厂必须确认尺寸分档、特殊疵点、封顶规则和合格阈值后另行发布正式版本。
 */
export const DEV_DEFAULT_FOUR_POINT_RULES: StandardRulesInput = {
  schemaVersion: 1,
  fourPoint: {
    dimensionBasis: 'MAX_DIMENSION',
    bands: [
      { maxCm: 7.62, points: 1 },
      { maxCm: 15.24, points: 2 },
      { maxCm: 22.86, points: 3 },
      { maxCm: null, points: 4 },
    ],
    specialRules: [
      {
        mode: 'BY_SIZE',
        defectTypeCodes: ['HOLE'],
        bands: [
          { maxCm: 2.54, points: 2 },
          { maxCm: null, points: 4 },
        ],
        note: '破洞：≤1 英寸 2 分，>1 英寸 4 分',
      },
      {
        mode: 'PER_LINEAR_UNIT',
        defectTypeCodes: ['SHADING', 'CONT_STREAK'],
        points: 4,
        note: '连续性疵点：每码 4 分',
      },
    ],
    maxPointsPerLinearUnit: { unitLengthM: 0.9144, maxPoints: 4 },
    areaUnit: 'PER_100_SQ_YD',
  },
  thresholds: { maxNormalizedPoints: 40 },
  failOnSeverity: 'CRITICAL',
  requireDefectPhoto: true,
};
