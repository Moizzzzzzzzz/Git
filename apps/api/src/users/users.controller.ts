import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  createUserSchema,
  departmentSchema,
  paginationSchema,
  resetPasswordSchema,
  ROLE_CODES,
  RoleCode,
  updateUserSchema,
  USER_STATUSES,
} from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { UsersService } from './users.service';

const listQuery = paginationSchema.extend({
  role: z.enum(ROLE_CODES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  departmentId: z.string().uuid().optional(),
});
const optionsQuery = z.object({ role: z.enum(ROLE_CODES).optional() });
const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listDepartments();
  }

  @Post()
  @Roles(RoleCode.ADMIN)
  create(@CurrentActor() a: Actor, @Body(zod(departmentSchema)) b: z.infer<typeof departmentSchema>, @ReqMeta() m: RequestMeta) {
    return this.users.createDepartment(a, b, m);
  }

  @Put(':id')
  @Roles(RoleCode.ADMIN)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(departmentSchema)) b: z.infer<typeof departmentSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.updateDepartment(a, id, b, m);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** 下拉选项：任务分配等场景需要，管理类角色可用 */
  @Get('options')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR)
  options(@Query(zod(optionsQuery)) q: z.infer<typeof optionsQuery>) {
    return this.users.options(q.role);
  }

  @Get()
  @Roles(RoleCode.ADMIN)
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.users.list(q);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN)
  get(@Param('id', uuid) id: string) {
    return this.users.get(id);
  }

  @Post()
  @Roles(RoleCode.ADMIN)
  create(@CurrentActor() a: Actor, @Body(zod(createUserSchema)) b: z.infer<typeof createUserSchema>, @ReqMeta() m: RequestMeta) {
    return this.users.create(a, b, m);
  }

  @Put(':id')
  @Roles(RoleCode.ADMIN)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(updateUserSchema)) b: z.infer<typeof updateUserSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.update(a, id, b, m);
  }

  @Post(':id/password')
  @Roles(RoleCode.ADMIN)
  @HttpCode(200)
  resetPassword(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(resetPasswordSchema)) b: z.infer<typeof resetPasswordSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.resetPassword(a, id, b.password, m);
  }

  @Post(':id/bind-code')
  @Roles(RoleCode.ADMIN)
  bindCode(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) {
    return this.users.generateBindCode(a, id, m);
  }

  @Post(':id/unbind-wechat')
  @Roles(RoleCode.ADMIN)
  @HttpCode(200)
  unbind(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) {
    return this.users.unbindWechat(a, id, m);
  }

  @Post(':id/force-logout')
  @Roles(RoleCode.ADMIN)
  @HttpCode(200)
  forceLogout(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) {
    return this.users.forceLogout(a, id, m);
  }
}
