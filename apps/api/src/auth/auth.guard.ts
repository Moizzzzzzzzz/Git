import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@fabricqc/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { IS_PUBLIC, ROLES } from '../common/decorators';
import { hasRole, type Actor } from '../common/actor';
import { TokenService } from './token.service';

/** 全局守卫：默认所有接口都需要登录；@Roles 限定角色 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw AppError.unauthenticated();
    const actor = await this.tokens.authenticate(token);
    req.actor = actor;

    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(ROLES, targets);
    if (roles?.length && !hasRole(actor, ...roles)) throw AppError.forbidden();
    return true;
  }
}
