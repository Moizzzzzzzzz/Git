import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientType, ErrorCode } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { sha256 } from '../common/codes';
import type { Actor } from '../common/actor';

export interface AccessPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  private newRefreshToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  }

  private signAccess(userId: string, sessionId: string) {
    const payload: AccessPayload = { sub: userId, sid: sessionId, typ: 'access' };
    return this.jwt.sign(payload, { expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS });
  }

  async issue(
    userId: string,
    clientType: ClientType,
    meta: { ip: string | null; userAgent: string | null },
    tx?: Tx,
  ): Promise<IssuedTokens> {
    const db = tx ?? this.prisma;
    const { token, hash } = this.newRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    const session = await db.authSession.create({
      data: { userId, clientType, refreshTokenHash: hash, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });
    return {
      accessToken: this.signAccess(userId, session.id),
      accessTokenExpiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: token,
      refreshTokenExpiresAt: expiresAt,
      sessionId: session.id,
    };
  }

  /** 刷新并轮换。旧令牌被再次使用视为泄露，立即撤销整个会话。 */
  async refresh(refreshToken: string, expectedClient?: ClientType): Promise<IssuedTokens> {
    const hash = sha256(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { status: true } } },
    });
    if (!session) {
      const reused = await this.prisma.authSession.findUnique({ where: { previousRefreshTokenHash: hash } });
      if (reused && !reused.revokedAt) {
        await this.revoke(reused.id, 'REFRESH_TOKEN_REUSE');
      }
      throw AppError.unauthenticated('登录已失效，请重新登录', ErrorCode.SESSION_REVOKED);
    }
    if (expectedClient && session.clientType !== expectedClient) {
      throw AppError.unauthenticated('登录已失效，请重新登录', ErrorCode.SESSION_REVOKED);
    }
    if (session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw AppError.unauthenticated('登录已失效，请重新登录', ErrorCode.SESSION_REVOKED);
    }
    const next = this.newRefreshToken();
    // 条件更新保证并发刷新时只有一个成功
    const updated = await this.prisma.authSession.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: { refreshTokenHash: next.hash, previousRefreshTokenHash: hash, lastUsedAt: new Date() },
    });
    if (updated.count !== 1) throw AppError.unauthenticated('登录已失效，请重新登录', ErrorCode.SESSION_REVOKED);
    return {
      accessToken: this.signAccess(session.userId, session.id),
      accessTokenExpiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: next.token,
      refreshTokenExpiresAt: session.expiresAt,
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string, reason: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeAllForUser(userId: string, reason: string, tx?: Tx, clientType?: ClientType) {
    const db = tx ?? this.prisma;
    const r = await db.authSession.updateMany({
      where: { userId, revokedAt: null, ...(clientType ? { clientType } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return r.count;
  }

  /** 校验 Access Token 并从数据库加载主体（会话被撤销 / 用户被禁用立即失效） */
  async authenticate(accessToken: string): Promise<Actor> {
    let payload: AccessPayload;
    try {
      payload = this.jwt.verify<AccessPayload>(accessToken);
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') {
        throw AppError.unauthenticated('登录已过期', ErrorCode.TOKEN_EXPIRED);
      }
      throw AppError.unauthenticated('登录凭证无效');
    }
    if (payload.typ !== 'access') throw AppError.unauthenticated('登录凭证无效');
    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: {
        user: { include: { roles: { include: { role: true } } } },
      },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date()) {
      throw AppError.unauthenticated('登录已失效，请重新登录', ErrorCode.SESSION_REVOKED);
    }
    const u = session.user;
    if (u.status !== 'ACTIVE') throw AppError.unauthenticated('账号已停用', ErrorCode.SESSION_REVOKED);
    return {
      userId: u.id,
      name: u.name,
      employeeNo: u.employeeNo,
      departmentId: u.departmentId,
      roles: u.roles.map((r) => ({ role: r.role.code, departmentId: r.departmentId })),
      sessionId: session.id,
      clientType: session.clientType,
    };
  }
}
