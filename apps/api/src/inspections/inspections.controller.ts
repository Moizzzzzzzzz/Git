import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  INSPECTION_STATUSES,
  inspectionDraftSchema,
  paginationSchema,
  RoleCode,
  startInspectionSchema,
  submitInspectionSchema,
} from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { MANAGE_TASKS, type Actor } from '../common/actor';
import { InspectionsService } from './inspections.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const listQuery = paginationSchema.extend({
  status: z.enum(INSPECTION_STATUSES).optional(),
  overallResult: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_APPLICABLE']).optional(),
  inspectorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const reopenBody = z.object({ reason: z.string().trim().min(2).max(500) });

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly svc: InspectionsService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(a, q);
  }

  @Post()
  @Roles(RoleCode.INSPECTOR)
  start(@CurrentActor() a: Actor, @Body(zod(startInspectionSchema)) b: z.infer<typeof startInspectionSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.start(a, b, m);
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuid) id: string) {
    return this.svc.get(a, id);
  }

  @Put(':id/draft')
  @Roles(RoleCode.INSPECTOR)
  saveDraft(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(inspectionDraftSchema)) b: z.infer<typeof inspectionDraftSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.saveDraft(a, id, b, m);
  }

  @Post(':id/submit')
  @Roles(RoleCode.INSPECTOR)
  @HttpCode(200)
  submit(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(submitInspectionSchema)) b: z.infer<typeof submitInspectionSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.submit(a, id, b, m);
  }

  @Post(':id/reopen')
  @Roles(...MANAGE_TASKS)
  @HttpCode(200)
  reopen(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @Body(zod(reopenBody)) b: z.infer<typeof reopenBody>, @ReqMeta() m: RequestMeta) {
    return this.svc.reopen(a, id, b.reason, m);
  }
}
