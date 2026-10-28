import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RoleCode } from '@fabricqc/shared';
import type { Request } from 'express';
import type { Actor } from './actor';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** 无需登录的接口 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** 允许访问的角色（任一即可）。不加则仅要求登录 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES, roles);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
  return req.actor as Actor;
});

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
    requestId: req.requestId ?? null,
  };
});
