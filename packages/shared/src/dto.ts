import { z } from 'zod';
import {
  DEFECT_SEVERITIES,
  INSPECTION_MODES,
  INSPECTION_SCOPES,
  ROLE_CODES,
  STANDARD_KINDS,
  USER_STATUSES,
} from './enums';
import { standardRulesSchema } from './rules';
import { templateContentSchema } from './inspection';

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v));
const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null));
const optionalNumber = (min: number, max: number) => z.number().finite().min(min).max(max).optional().nullable();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ---------- 认证 ----------
export const adminLoginSchema = z.object({
  username: trimmed(64),
  password: z.string().min(1).max(200),
});

export const wechatLoginSchema = z.object({ code: z.string().min(1).max(200) });

export const wechatBindSchema = z.object({
  /** /auth/wechat/login 返回的短期绑定票据（内含已校验的 OpenID） */
  bindTicket: z.string().min(20).max(2000),
  employeeNo: trimmed(32),
  bindCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{8}$/, '绑定码为 8 位字母或数字'),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200).optional() });

export const passwordSchema = z
  .string()
  .min(10, '密码至少 10 位')
  .max(128)
  .regex(/[A-Za-z]/, '密码需包含字母')
  .regex(/[0-9]/, '密码需包含数字');

// ---------- 组织 ----------
export const departmentSchema = z.object({
  code: trimmed(32).regex(/^[A-Za-z0-9_-]+$/, '编码只能包含字母、数字、下划线和连字符'),
  name: trimmed(64),
});

export const roleAssignmentSchema = z.object({
  role: z.enum(ROLE_CODES),
  departmentId: optionalUuid,
});

export const createUserSchema = z.object({
  employeeNo: trimmed(32).regex(/^[A-Za-z0-9_-]+$/, '员工编号只能包含字母、数字、下划线和连字符'),
  name: trimmed(64),
  departmentId: optionalUuid,
  position: optionalText(64),
  phone: optionalText(32),
  supervisorId: optionalUuid,
  roles: z.array(roleAssignmentSchema).min(1, '至少分配一个角色'),
  username: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_.-]*$/, '用户名只能包含字母、数字、下划线、点和连字符')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  password: passwordSchema.optional().nullable().or(z.literal('').transform(() => null)),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .omit({ employeeNo: true, password: true })
  .extend({ status: z.enum(USER_STATUSES) });

export const resetPasswordSchema = z.object({ password: passwordSchema });

// ---------- 基础资料 ----------
export const customerSchema = z.object({
  code: trimmed(32),
  name: trimmed(128),
  contactName: optionalText(64),
  contactPhone: optionalText(32),
  notes: optionalText(500),
  isActive: z.boolean().default(true),
});

export const fabricSchema = z.object({
  code: trimmed(64),
  nameZh: trimmed(128),
  nameEn: optionalText(128),
  composition: optionalText(200),
  widthCm: optionalNumber(1, 1000),
  cuttableWidthCm: optionalNumber(1, 1000),
  gsm: optionalNumber(1, 5000),
  weaveStructure: optionalText(64),
  coatingType: optionalText(64),
  color: optionalText(64),
  colorCode: optionalText(64),
  customerId: optionalUuid,
  defaultFourPointStandardId: optionalUuid,
  defaultCustomerStandardId: optionalUuid,
  defaultTemplateId: optionalUuid,
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});
export type FabricInput = z.input<typeof fabricSchema>;

export const productionLotSchema = z.object({
  fabricId: z.string().uuid(),
  lotNo: trimmed(64),
  dyeLotNo: z.string().trim().max(64).default(''),
  colorCode: optionalText(64),
  producedAt: z.coerce.date().optional().nullable(),
  notes: optionalText(500),
});

export const rollSchema = z.object({
  rollNo: trimmed(64).regex(/^[A-Za-z0-9_\-./]+$/, '卷号只能包含字母、数字和 _ - . /'),
  fabricId: z.string().uuid(),
  lotId: optionalUuid,
  dyeLotNo: optionalText(64),
  colorCode: optionalText(64),
  nominalLengthM: optionalNumber(0.01, 100000),
  notes: optionalText(500),
});
export type RollInput = z.input<typeof rollSchema>;

export const updateRollSchema = rollSchema.omit({ rollNo: true });

/** 批量导入：一行一卷，按面料货号 + 批号匹配 */
export const rollImportRowSchema = z.object({
  rollNo: trimmed(64).regex(/^[A-Za-z0-9_\-./]+$/, '卷号只能包含字母、数字和 _ - . /'),
  fabricCode: trimmed(64),
  lotNo: optionalText(64),
  dyeLotNo: optionalText(64),
  colorCode: optionalText(64),
  nominalLengthM: z.coerce.number().finite().positive().max(100000).optional().nullable(),
  notes: optionalText(500),
});
export const rollImportSchema = z.object({
  rows: z.array(rollImportRowSchema).min(1).max(2000),
  createMissingLots: z.boolean().default(true),
});

export const defectTypeSchema = z.object({
  code: trimmed(32).regex(/^[A-Z][A-Z0-9_]*$/, '编码使用大写字母、数字和下划线'),
  nameZh: trimmed(64),
  nameEn: optionalText(64),
  category: optionalText(32),
  defaultSeverity: z.enum(DEFECT_SEVERITIES).default('MINOR'),
  sortOrder: z.number().int().min(0).max(9999).default(100),
  isActive: z.boolean().default(true),
});

export const qualityStandardSchema = z.object({
  code: trimmed(64),
  name: trimmed(128),
  kind: z.enum(STANDARD_KINDS),
  customerId: optionalUuid,
  description: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const standardVersionSchema = z.object({
  rules: standardRulesSchema,
  notes: optionalText(1000),
});

export const inspectionTemplateSchema = z.object({
  code: trimmed(64),
  name: trimmed(128),
  description: optionalText(500),
  content: templateContentSchema,
  isActive: z.boolean().default(true),
});

// ---------- 任务 ----------
export const createTaskSchema = z.object({
  title: trimmed(128),
  assigneeId: z.string().uuid(),
  reviewerId: optionalUuid,
  departmentId: optionalUuid,
  customerId: optionalUuid,
  defaultMode: z.enum(INSPECTION_MODES).optional().nullable(),
  defaultScope: z.enum(INSPECTION_SCOPES).default('FULL'),
  fourPointStandardId: z.string().uuid(),
  customerStandardId: optionalUuid,
  templateId: z.string().uuid(),
  rollIds: z.array(z.string().uuid()).min(1, '至少选择一卷').max(500),
  dueAt: z.coerce.date().optional().nullable(),
  notes: optionalText(1000),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: trimmed(128).optional(),
  assigneeId: z.string().uuid().optional(),
  reviewerId: optionalUuid,
  dueAt: z.coerce.date().optional().nullable(),
  notes: optionalText(1000),
  status: z.enum(['OPEN', 'CANCELLED']).optional(),
});

export const addTaskRollsSchema = z.object({ rollIds: z.array(z.string().uuid()).min(1).max(500) });

export const wechatSubscribeSchema = z.object({
  results: z
    .array(z.object({ templateId: z.string().min(1).max(128), accepted: z.boolean() }))
    .min(1)
    .max(10),
});

export const systemSettingsSchema = z.object({
  companyName: trimmed(128).optional(),
  bindCodeTtlHours: z.number().int().min(1).max(168).optional(),
});
