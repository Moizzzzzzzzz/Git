import type { Env } from './env';

/** 注入令牌：业务代码通过 AppConfig 读取配置，不直接读 process.env */
export class AppConfig {
  constructor(readonly env: Env) {}

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get wechatConfigured(): boolean {
    return Boolean(this.env.WECHAT_APP_ID && this.env.WECHAT_APP_SECRET);
  }

  get storageConfigured(): boolean {
    const e = this.env;
    return Boolean(e.STORAGE_ENDPOINT && e.STORAGE_BUCKET && e.STORAGE_ACCESS_KEY_ID && e.STORAGE_SECRET_ACCESS_KEY);
  }
}
