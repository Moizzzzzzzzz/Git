import { Body, Controller, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { RoleCode, selectVcansSampleSchema, registerVcansRollsSchema, additionalVcansSampleSchema, vcansMeasurementsSchema } from '@fabricqc/shared';
import type { z } from 'zod';
import { CurrentActor, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { VcansOrdersService } from './vcans-orders.service';
import { LotPurposeGuard } from './test-purpose.guard';

@Controller('lots')
@UseGuards(LotPurposeGuard)
export class VcansLotsController {
  constructor(private readonly svc: VcansOrdersService) {}
  @Put(':id/rolls/:rollId/measurements')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  measurements(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('rollId', new ParseUUIDPipe({ version: '4' })) rollId: string, @Body(zod(vcansMeasurementsSchema)) body: z.infer<typeof vcansMeasurementsSchema>) { return this.svc.updateMeasurements(actor, id, rollId, body); }
  @Post(':id/additional-inspections')
  @Roles(RoleCode.QC_SUPERVISOR)
  addAdditional(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(additionalVcansSampleSchema)) body: z.infer<typeof additionalVcansSampleSchema>) { return this.svc.addAdditional(actor, id, body); }
  @Post(':id/rolls')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  registerRolls(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(registerVcansRollsSchema)) body: z.infer<typeof registerVcansRollsSchema>) { return this.svc.registerRolls(actor, id, body); }
  @Post(':id/original-sample-selection')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  selectOriginal(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(selectVcansSampleSchema)) body: z.infer<typeof selectVcansSampleSchema>) { return this.svc.selectOriginal(actor, id, body); }
}
