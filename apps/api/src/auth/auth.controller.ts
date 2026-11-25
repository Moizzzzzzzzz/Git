import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  adminLoginSchema,
  ClientType,
  refreshSchema,
  wechatBindSchema,
  wechatLoginSchema,
} from '@fabricqc/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/app-error';
import { CurrentActor, Public, ReqMeta, type RequestMeta } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { AuthService } from './auth.service';
import { TokenService, type IssuedTokens } from './token.service';

const COOKIE = 'fqc_rt';
const COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  private setCookie(res: Response, t: IssuedTokens) {
    res.cookie(COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: this.config.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: t.refreshTokenExpiresAt,
    });
  }

  private adminBody(t: IssuedTokens) {
    return { accessToken: t.accessToken, accessTokenExpiresIn: t.accessTokenExpiresIn };
  }

  private miniBody(t: IssuedTokens) {
    return {
      accessToken: t.accessToken,
      accessTokenExpiresIn: t.accessTokenExpiresIn,
      refreshToken: t.refreshToken,
      refreshTokenExpiresAt: t.refreshTokenExpiresAt,
    };
  }

  /** PC 后台登录：Refresh Token 写入 httpOnly Cookie */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('admin/login')
  @HttpCode(200)
  async adminLogin(
    @Body(zod(adminLoginSchema)) body: z.infer<typeof adminLoginSchema>,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.adminLogin(body.username, body.password, meta);
    this.setCookie(res, t);
    return this.adminBody(t);
  }

  /** PC 后台刷新：读取 Cookie，并要求自定义请求头防 CSRF */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('admin/refresh')
  @HttpCode(200)
  async adminRefresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.header('x-requested-with') !== 'fabricqc-admin') throw AppError.forbidden('非法请求');
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE];
    if (!token) throw AppError.unauthenticated('登录已失效，请重新登录');
    const t = await this.tokens.refresh(token, ClientType.ADMIN_WEB);
    this.setCookie(res, t);
    return this.adminBody(t);
  }

  @Post('admin/logout')
  @HttpCode(200)
  async adminLogout(@CurrentActor() actor: Actor, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor, meta);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  }

  /** 小程序：wx.login 的 code 换取登录态；未绑定时返回绑定票据 */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('wechat/login')
  @HttpCode(200)
  async wechatLogin(@Body(zod(wechatLoginSchema)) body: z.infer<typeof wechatLoginSchema>, @ReqMeta() meta: RequestMeta) {
    const r = await this.auth.wechatLogin(body.code, meta);
    return r.status === 'BOUND' ? { status: r.status, ...this.miniBody(r.tokens) } : r;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('wechat/bind')
  @HttpCode(200)
  async wechatBind(@Body(zod(wechatBindSchema)) body: z.infer<typeof wechatBindSchema>, @ReqMeta() meta: RequestMeta) {
    const r = await this.auth.wechatBind(body, meta);
    return { status: r.status, ...this.miniBody(r.tokens) };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(zod(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    if (!body.refreshToken) throw AppError.unauthenticated('缺少刷新令牌');
    const t = await this.tokens.refresh(body.refreshToken, ClientType.MINIAPP);
    return this.miniBody(t);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentActor() actor: Actor, @ReqMeta() meta: RequestMeta) {
    await this.auth.logout(actor, meta);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }
}
