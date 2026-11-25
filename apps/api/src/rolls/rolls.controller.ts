import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  paginationSchema,
  parseRollQr,
  ROLL_STATUSES,
  rollImportSchema,
  rollSchema,
  updateRollSchema,
} from '@fabricqc/shared';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { type Actor } from '../common/actor';
import { RollsService } from './rolls.service';
import { hasRole } from '../common/actor';
import { RoleCode } from '@fabricqc/shared';

const uuid = new ParseUUIDPipe({ version: '4' });
const listQuery = paginationSchema.extend({
  fabricId: z.string().uuid().optional(),
  lotId: z.string().uuid().optional(),
  status: z.enum(ROLL_STATUSES).optional(),
});
const labelsBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

@Controller('rolls')
export class RollsController {
  constructor(private readonly rolls: RollsService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    if (!hasRole(a, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检权限');
    return this.rolls.list(q, a);
  }

  /** 扫码入口：接受完整二维码内容或标识 */
  @Get('by-qr/:code')
  byQr(@CurrentActor() a: Actor, @Param('code') raw: string) {
    if (!hasRole(a, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检权限');
    const code = parseRollQr(decodeURIComponent(raw));
    if (!code) throw AppError.badRequest('无法识别的布卷二维码');
    return this.rolls.byQr(a, code);
  }

  @Get('by-no/:rollNo/history')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  async historyByNo(@CurrentActor() a: Actor, @Param('rollNo') rollNo: string) {
    const id = await this.rolls.findIdByRollNo(rollNo);
    await this.rolls.assertAccess(a, id);
    return this.rolls.history(id, a);
  }

  @Post('labels')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR)
  async labels(@CurrentActor() a: Actor, @Body(zod(labelsBody)) b: z.infer<typeof labelsBody>) {
    for (const id of b.ids) await this.rolls.assertAccess(a, id);
    return this.rolls.labels(b.ids);
  }

  @Post('import')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR)
  import(@CurrentActor() a: Actor, @Body(zod(rollImportSchema)) b: z.infer<typeof rollImportSchema>, @ReqMeta() m: RequestMeta) {
    return this.rolls.import(a, b, m);
  }

  @Get(':id')
  async get(@CurrentActor() a: Actor, @Param('id', uuid) id: string) {
    if (!hasRole(a, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检权限');
    await this.rolls.assertAccess(a, id);
    return this.rolls.get(id);
  }

  @Get(':id/qr')
  async qr(@CurrentActor() a: Actor, @Param('id', uuid) id: string) {
    if (!hasRole(a, RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)) throw AppError.forbidden('没有质检权限');
    await this.rolls.assertAccess(a, id);
    return this.rolls.qr(id);
  }

  @Get(':id/history')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  async history(@CurrentActor() a: Actor, @Param('id', uuid) id: string) {
    await this.rolls.assertAccess(a, id);
    return this.rolls.history(id, a);
  }

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR)
  create(@CurrentActor() a: Actor, @Body(zod(rollSchema)) b: z.infer<typeof rollSchema>, @ReqMeta() m: RequestMeta) {
    return this.rolls.create(a, b, m);
  }

  @Put(':id')
  @Roles(RoleCode.ADMIN, RoleCode.QUALITY_MANAGER, RoleCode.QC_SUPERVISOR)
  async update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(updateRollSchema)) b: z.infer<typeof updateRollSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    await this.rolls.assertAccess(a, id);
    return this.rolls.update(a, id, b, m);
  }
}
