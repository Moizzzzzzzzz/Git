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
import { MANAGE_MASTER_DATA, VIEW_QC_RECORDS, type Actor } from '../common/actor';
import { RollsService } from './rolls.service';

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
  list(@Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.rolls.list(q);
  }

  /** 扫码入口：接受完整二维码内容或标识 */
  @Get('by-qr/:code')
  byQr(@CurrentActor() a: Actor, @Param('code') raw: string) {
    const code = parseRollQr(decodeURIComponent(raw));
    if (!code) throw AppError.badRequest('无法识别的布卷二维码');
    return this.rolls.byQr(a, code);
  }

  @Get('by-no/:rollNo/history')
  @Roles(...VIEW_QC_RECORDS)
  async historyByNo(@Param('rollNo') rollNo: string) {
    return this.rolls.history(await this.rolls.findIdByRollNo(rollNo));
  }

  @Post('labels')
  @Roles(...MANAGE_MASTER_DATA)
  labels(@Body(zod(labelsBody)) b: z.infer<typeof labelsBody>) {
    return this.rolls.labels(b.ids);
  }

  @Post('import')
  @Roles(...MANAGE_MASTER_DATA)
  import(@CurrentActor() a: Actor, @Body(zod(rollImportSchema)) b: z.infer<typeof rollImportSchema>, @ReqMeta() m: RequestMeta) {
    return this.rolls.import(a, b, m);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.rolls.get(id);
  }

  @Get(':id/qr')
  qr(@Param('id', uuid) id: string) {
    return this.rolls.qr(id);
  }

  @Get(':id/history')
  @Roles(...VIEW_QC_RECORDS)
  history(@Param('id', uuid) id: string) {
    return this.rolls.history(id);
  }

  @Post()
  @Roles(...MANAGE_MASTER_DATA)
  create(@CurrentActor() a: Actor, @Body(zod(rollSchema)) b: z.infer<typeof rollSchema>, @ReqMeta() m: RequestMeta) {
    return this.rolls.create(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_MASTER_DATA)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(updateRollSchema)) b: z.infer<typeof updateRollSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.rolls.update(a, id, b, m);
  }
}
