import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase())),
    z.boolean(),
  );
const jsonRecord = z.preprocess((v) => {
  if (v === undefined || v === '') return {};
  try {
    return JSON.parse(String(v));
  } catch {
    return '__invalid__';
  }
}, z.record(z.string(), z.string()));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  QR_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RUN_WORKERS: bool(true),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET 至少 32 位'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  BIND_CODE_PEPPER: z.string().min(16, 'BIND_CODE_PEPPER 至少 16 位'),
  BIND_CODE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  BIND_CODE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(50).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  COOKIE_SECURE: bool(false),

  WECHAT_APP_ID: optionalString,
  WECHAT_APP_SECRET: optionalString,
  WECHAT_TPL_REVIEW_REQUEST: optionalString,
  WECHAT_TPL_REVIEW_RESULT: optionalString,
  WECHAT_TPL_REVIEW_REQUEST_FIELDS: jsonRecord,
  WECHAT_TPL_REVIEW_RESULT_FIELDS: jsonRecord,
  WECHAT_MINIPROGRAM_STATE: z.enum(['developer', 'trial', 'formal']).default('formal'),

  STORAGE_PROVIDER: z.enum(['cos', 'minio', 's3']).default('cos'),
  STORAGE_ENDPOINT: optionalString.pipe(z.string().url().optional()),
  STORAGE_PUBLIC_ENDPOINT: optionalString.pipe(z.string().url().optional()),
  STORAGE_REGION: z.string().default('ap-shanghai'),
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY_ID: optionalString,
  STORAGE_SECRET_ACCESS_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: bool(false),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  VIEW_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`环境变量配置错误：\n${lines.join('\n')}\n请对照 .env.example 检查。`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('生产环境必须设置 COOKIE_SECURE=true（HTTPS）');
  }
  return env;
}
