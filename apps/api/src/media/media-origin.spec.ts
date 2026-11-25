import { mediaOriginMiddleware, useDomainMediaOrigin } from './media-origin';
import { S3StorageAdapter } from './storage.adapter';
import { envSchema, loadEnv } from '../config/env';

const env = { STORAGE_PROVIDER: 'minio', STORAGE_BUCKET: 'demo-media', STORAGE_REGION: 'ap-shanghai', STORAGE_FORCE_PATH_STYLE: true, STORAGE_ENDPOINT: 'http://demo-minio:9000', STORAGE_PUBLIC_ENDPOINT: 'https://192.0.2.1', STORAGE_DOMAIN_PUBLIC_ENDPOINT: 'https://example.invalid', STORAGE_ACCESS_KEY_ID: 'TEST-KEY', STORAGE_SECRET_ACCESS_KEY: 'PUBLIC_REDACTED' };
const adapter = (e: typeof env | Omit<typeof env, 'STORAGE_DOMAIN_PUBLIC_ENDPOINT'> & { STORAGE_DOMAIN_PUBLIC_ENDPOINT?: string } = env) => new S3StorageAdapter({ env: e, storageConfigured: true } as never);
function request<T>(header: string | string[] | undefined, action: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => mediaOriginMiddleware({ headers: { 'x-fabricqc-media-origin': header } } as never, {} as never, () => { action().then(resolve, reject); }));
}

it('parallel requests use only their own fixed signed origin for original, thumbnail and upload', async () => {
  const storage = adapter();
  const sign = () => Promise.all([storage.presignPut('inspections/a.jpg', 'image/jpeg', 60), storage.presignGet('frozen-inspections/a/original', 60), storage.presignGet('frozen-inspections/a/thumbnail', 60)]);
  const [ip, domain] = await Promise.all([request('ip', sign), request('domain', sign)]);
  for (const value of ip) expect(new URL(value).origin).toBe('https://192.0.2.1');
  for (const value of domain) expect(new URL(value).origin).toBe('https://example.invalid');
  expect(new URL(ip[0]).searchParams.get('X-Amz-Signature')).not.toBe(new URL(domain[0]).searchParams.get('X-Amz-Signature'));
  expect(useDomainMediaOrigin()).toBe(false);
});

it('missing, malformed or arbitrary values use IP, and disabled domain stays compatible', async () => {
  for (const value of [undefined, 'https://evil.example', 'domain, ip', ['domain', 'ip']]) {
    const signed = await request(value, () => adapter().presignGet('image', 60));
    expect(new URL(signed).origin).toBe('https://192.0.2.1');
  }
  const disabled = { ...env, STORAGE_DOMAIN_PUBLIC_ENDPOINT: undefined };
  expect(new URL(await request('domain', () => adapter(disabled).presignGet('image', 60))).origin).toBe('https://192.0.2.1');
});

it('configuration accepts only the exact domain endpoint', () => {
  const schema = envSchema.shape.STORAGE_DOMAIN_PUBLIC_ENDPOINT;
  expect(schema.safeParse('https://example.invalid').success).toBe(true);
  for (const value of ['http://example.invalid', 'https://example.invalid:444', 'https://example.invalid/path', 'https://example.invalid.evil.example']) expect(schema.safeParse(value).success).toBe(false);
});

it('enabling dual-origin signing rejects a different existing public endpoint', () => {
  const base = { NODE_ENV: 'test', PUBLIC_BASE_URL: 'https://example.test', QR_BASE_URL: 'https://example.test', DATABASE_URL: 'postgres://local/db', REDIS_URL: 'redis://localhost', JWT_ACCESS_SECRET: 'a'.repeat(32), BIND_CODE_PEPPER: 'b'.repeat(16), STORAGE_PUBLIC_ENDPOINT: 'https://192.0.2.1', STORAGE_DOMAIN_PUBLIC_ENDPOINT: 'https://example.invalid' };
  expect(() => loadEnv(base)).not.toThrow();
  expect(() => loadEnv({ ...base, STORAGE_PUBLIC_ENDPOINT: 'https://example.test' })).toThrow();
  expect(() => loadEnv({ ...base, STORAGE_PUBLIC_ENDPOINT: 'https://example.test', STORAGE_DOMAIN_PUBLIC_ENDPOINT: '' })).not.toThrow();
});
