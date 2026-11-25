/** The original inspection requirement for one dye lot. Percentages are decimal strings. */
export type VcansInspectionPlan =
  | { mode: 'FULL' }
  | { mode: 'FIXED_PER_LOT'; fixedRolls: number }
  | { mode: 'PERCENT_PER_LOT'; percent: string };

export function requiredSampleCount(totalRolls: number, plan: VcansInspectionPlan): number {
  if (!Number.isSafeInteger(totalRolls) || totalRolls < 0) throw new RangeError('Invalid roll count');
  if (plan.mode === 'FULL') return totalRolls;
  if (plan.mode === 'FIXED_PER_LOT') {
    if (!Number.isSafeInteger(plan.fixedRolls) || plan.fixedRolls < 1) throw new RangeError('Invalid fixed sample count');
    return Math.min(totalRolls, plan.fixedRolls);
  }
  if (!/^(?:\d{1,3})(?:\.\d{1,4})?$/.test(plan.percent)) throw new RangeError('Invalid percentage');
  const [whole, fraction = ''] = plan.percent.split('.');
  const units = Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
  if (units <= 0 || units > 1000000) throw new RangeError('Invalid percentage');
  if (!totalRolls) return 0;
  const numerator = BigInt(totalRolls) * BigInt(units);
  const denominator = BigInt(1000000);
  return Number((numerator + denominator - BigInt(1)) / denominator);
}

import { z } from 'zod';
const optionalText = z.string().trim().max(500).nullable().optional();
const samplePlanSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FULL') }).strict(),
  z.object({ mode: z.literal('FIXED_PER_LOT'), fixedRolls: z.number().int().positive().max(2147483647) }).strict(),
  z.object({ mode: z.literal('PERCENT_PER_LOT'), percent: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((v) => Number(v) > 0 && Number(v) <= 100) }).strict(),
]);
export const createVcansOrderSchema = z.object({
  requiredStandardMode: z.enum(['FACTORY', 'CUSTOMER_REQUIRED']).optional(),
  hNo: z.string().trim().min(1).max(100),
  businessDepartmentId: z.string().uuid(),
  supervisorId: z.string().uuid(),
  fourPointStandardId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  plan: samplePlanSchema,
  lines: z.array(z.object({
    customerOrderNo: optionalText, productName: optionalText, productCode: optionalText,
    color: optionalText, specification: optionalText,
    quantity: z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).nullable().optional(), quantityUnit: optionalText,
  }).strict()).min(1).max(500),
}).strict();
export const assignVcansOrderSchema = z.object({
  assigneeId: z.string().uuid(), version: z.number().int().nonnegative(), reason: z.string().trim().max(500).optional(),
}).strict();
export const createVcansLotSchema = z.object({
  lineId: z.string().uuid(), dyeLotNo: z.string().trim().min(1).max(100),
  actualRollCount: z.number().int().positive().max(2147483647), version: z.number().int().nonnegative(),
}).strict();
export const vcansVersionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
export const updateVcansOrderSchema = z.object({
  version: z.number().int().nonnegative(),
  supervisorId: z.string().uuid().optional(),
  fourPointStandardId: z.string().uuid().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  plan: samplePlanSchema.optional(),
  lines: z.array(z.object({ id: z.string().uuid(), customerOrderNo: optionalText, productName: optionalText, productCode: optionalText, color: optionalText, specification: optionalText, quantity: z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).nullable().optional(), quantityUnit: optionalText }).strict()).min(1).max(500).refine((lines) => new Set(lines.map((l) => l.id)).size === lines.length, '明细不能重复').optional(),
}).strict();
export const selectVcansSampleSchema = z.object({
  version: z.number().int().nonnegative(),
  orderRollIds: z.array(z.string().uuid()).min(1).max(10000).refine((ids) => new Set(ids).size === ids.length, '卷不能重复'),
}).strict();
export const registerVcansRollsSchema = z.object({
  version: z.number().int().nonnegative(),
  fabricId: z.string().uuid().nullable().optional(),
  rolls: z.array(z.object({
    rollNo: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_\-./]+$/),
    nominalLengthM: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).nullable().optional(),
    nominalWeightKg: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();
export const additionalVcansSampleSchema = z.object({
  requestKey: z.string().uuid(),
  version: z.number().int().nonnegative(),
  orderRollIds: z.array(z.string().uuid()).min(1).max(10000).refine((ids) => new Set(ids).size === ids.length, '卷不能重复'),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const vcansImportPreviewSchema = z.object({
  filename: z.string().trim().min(1).max(255), fileBase64: z.string().min(4).max(6990508).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine((value) => value.length % 4 === 0),
  businessDepartmentId: z.string().uuid(), idempotencyKey: z.string().uuid(),
}).strict();
export const vcansImportCommitSchema = z.object({
  previewId: z.string().uuid(), idempotencyKey: z.string().uuid(),
  groups: z.array(z.object({ hNo: z.string().trim().min(1).max(100), businessDepartmentId: z.string().uuid(), supervisorId: z.string().uuid(), dueAt: z.string().datetime({ offset: true }).nullable().optional(), plan: samplePlanSchema, fourPointStandardId: z.string().uuid().nullable().optional(), templateId: z.string().uuid().nullable().optional(), requiredStandardMode: z.enum(['FACTORY', 'CUSTOMER_REQUIRED']).optional() }).strict()).min(1).max(1000).refine((groups) => new Set(groups.map((g) => g.hNo.trim().toUpperCase())).size === groups.length, 'H号重复'),
}).strict();
export const vcansReminderSchema = z.object({ idempotencyKey: z.string().uuid() }).strict();
export const vcansMeasurementsSchema = z.object({
  version: z.number().int().nonnegative(),
  measuredLengthM: z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/).refine((v) => Number(v) > 0).nullable().optional(),
  measuredWeightKg: z.string().regex(/^\d{1,7}(?:\.\d{1,3})?$/).refine((v) => Number(v) > 0).nullable().optional(),
}).strict().refine((v) => v.measuredLengthM !== undefined || v.measuredWeightKg !== undefined, '至少修改一项实测值');
