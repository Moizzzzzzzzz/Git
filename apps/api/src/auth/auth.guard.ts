import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@fabricqc/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { IS_PUBLIC, ROLES } from '../common/decorators';
import { hasRole, type Actor } from '../common/actor';
import { TokenService } from './token.service';
import { AppConfig } from '../config/app-config';
import { DemoSessionService } from '../demo/demo-session.service';
import { DemoActorService } from '../demo/demo-actor.service';
import { demoAuthRouteAllowed, demoPendingRouteAllowed } from '../demo/demo-route-policy';
import { reviewRouteAllowed } from '../demo/review-route-policy';

/** 全局守卫：默认所有接口都需要登录；@Roles 限定角色 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly demoSessions: DemoSessionService,
    private readonly demoActors: DemoActorService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const demo = this.config.env.DEMO_RUNTIME_MODE === 'demo';
    if (this.config.env.REVIEW_MODE && !reviewRouteAllowed(req.method,req.path)) throw AppError.forbidden('审核环境仅支持指定只读功能');
    if (demo && !demoAuthRouteAllowed(req.method, req.path)) throw AppError.forbidden('演示环境不支持此认证方式');
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthenticated();
    let actor: Actor;
    if (demo) {
      const allowPending = demoPendingRouteAllowed(req.method, req.path);
      const state = await this.demoSessions.context(token, allowPending);
      if (state.state !== 'ACTIVE' && !allowPending) throw AppError.forbidden('演示会话尚未启用');
      actor = await this.demoActors.load(state.claims.personaId, state.claims.sid);
    } else {
      actor = await this.tokens.authenticate(token);
    }
    req.actor = actor;

    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(ROLES, targets);
    if (roles?.length && !hasRole(actor, ...roles)) throw AppError.forbidden();
    return true;
  }
}
