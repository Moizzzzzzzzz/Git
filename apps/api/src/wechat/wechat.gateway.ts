import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';

export interface WechatSession {
  openId: string;
  unionId?: string;
}

export interface SubscribeMessage {
  openId: string;
  templateId: string;
  page: string;
  data: Record<string, { value: string }>;
}

/** 微信接口返回的业务错误（errcode 非 0） */
export class WechatApiError extends Error {
  constructor(
    readonly errcode: number,
    readonly errmsg: string,
  ) {
    super(`WeChat API error ${errcode}: ${errmsg}`);
  }
}

/**
 * 微信服务端接口抽象。生产实现直接调用微信官方 HTTPS 接口；
 * 测试中通过依赖注入替换，生产代码不包含任何模拟成功逻辑。
 */
export abstract class WechatGateway {
  abstract get appId(): string | null;
  abstract get configured(): boolean;
  abstract code2Session(code: string): Promise<WechatSession>;
  abstract sendSubscribeMessage(msg: SubscribeMessage): Promise<void>;
}

const API = 'https://api.weixin.qq.com';

@Injectable()
export class HttpWechatGateway extends WechatGateway {
  private readonly logger = new Logger('Wechat');
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  get appId() {
    return this.config.env.WECHAT_APP_ID ?? null;
  }

  get configured() {
    return this.config.wechatConfigured;
  }

  private ensureConfigured() {
    if (!this.configured) {
      throw AppError.of(
        ErrorCode.WECHAT_NOT_CONFIGURED,
        '服务器未配置微信小程序 AppID / AppSecret，暂不能使用微信登录',
        503,
      );
    }
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`WeChat HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async code2Session(code: string): Promise<WechatSession> {
    this.ensureConfigured();
    const e = this.config.env;
    const qs = new URLSearchParams({
      appid: e.WECHAT_APP_ID!,
      secret: e.WECHAT_APP_SECRET!,
      js_code: code,
      grant_type: 'authorization_code',
    });
    let r: { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    try {
      r = await this.fetchJson(`${API}/sns/jscode2session?${qs.toString()}`);
    } catch (err) {
      this.logger.warn(`code2Session network error: ${(err as Error).message}`);
      throw AppError.of(ErrorCode.WECHAT_API_ERROR, '连接微信服务器失败，请稍后重试', 502);
    }
    if (r.errcode || !r.openid) {
      // 40029 code 无效；40163 code 已被使用；45011 频率限制
      this.logger.warn(`code2Session errcode=${r.errcode} errmsg=${r.errmsg}`);
      throw AppError.of(ErrorCode.WECHAT_API_ERROR, '微信登录凭证无效或已过期，请重新进入小程序', 400, {
        errcode: r.errcode,
      });
    }
    // session_key 不落库、不下发
    return { openId: r.openid, unionId: r.unionid };
  }

  private async accessToken(force = false): Promise<string> {
    this.ensureConfigured();
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const e = this.config.env;
    const r = await this.fetchJson<{ access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }>(
      `${API}/cgi-bin/stable_token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credential',
          appid: e.WECHAT_APP_ID,
          secret: e.WECHAT_APP_SECRET,
          force_refresh: false,
        }),
      },
    );
    if (!r.access_token) throw new WechatApiError(r.errcode ?? -1, r.errmsg ?? 'no access_token');
    this.token = { value: r.access_token, expiresAt: Date.now() + ((r.expires_in ?? 7200) - 300) * 1000 };
    return this.token.value;
  }

  async sendSubscribeMessage(msg: SubscribeMessage): Promise<void> {
    const body = JSON.stringify({
      touser: msg.openId,
      template_id: msg.templateId,
      page: msg.page,
      data: msg.data,
      miniprogram_state: this.config.env.WECHAT_MINIPROGRAM_STATE,
      lang: 'zh_CN',
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt > 0);
      const r = await this.fetchJson<{ errcode?: number; errmsg?: string }>(
        `${API}/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      );
      if (!r.errcode) return;
      // 40001 / 42001 / 40014：access_token 失效，强制刷新后重试一次
      if ([40001, 42001, 40014].includes(r.errcode) && attempt === 0) continue;
      throw new WechatApiError(r.errcode, r.errmsg ?? '');
    }
  }
}
