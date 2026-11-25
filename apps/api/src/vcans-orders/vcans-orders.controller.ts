import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { assignVcansOrderSchema, createVcansLotSchema, createVcansOrderSchema, vcansVersionSchema, updateVcansOrderSchema, vcansReminderSchema, RoleCode } from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { VcansOrdersService } from './vcans-orders.service';

@Controller('orders')
export class VcansOrdersController {
  constructor(private readonly svc: VcansOrdersService) {}
  @Get()
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK, RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR, RoleCode.QUALITY_MANAGER, RoleCode.ADMIN)
  list(@CurrentActor() actor: Actor, @Query('q', zod(z.string().trim().max(100).optional())) query?: string) { return this.svc.list(actor, query || undefined); }
  @Get('options')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  options(@CurrentActor() actor: Actor) { return this.svc.options(actor); }
  @Get(':id/options')
  optionsForOrder(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.svc.orderOptions(actor, id); }
  @Get(':id/assignment-options')
  @Roles(RoleCode.QC_SUPERVISOR)
  assignmentOptions(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.svc.assignmentOptions(actor, id); }
  @Get(':id')
  detail(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.svc.detail(actor, id); }
  @Put(':id')
  update(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(updateVcansOrderSchema)) body: z.infer<typeof updateVcansOrderSchema>) { return this.svc.update(actor, id, body); }
  @Post(':id/reminders')
  @Roles(RoleCode.SALES)
  remind(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(vcansReminderSchema)) body: z.infer<typeof vcansReminderSchema>) { return this.svc.remind(actor, id, body); }
  @Post(':id/confirm')
  @Roles(RoleCode.QC_SUPERVISOR)
  confirm(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(vcansVersionSchema)) body: z.infer<typeof vcansVersionSchema>) { return this.svc.confirm(actor, id, body); }
  @Post(':id/activate')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  activate(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(vcansVersionSchema)) body: z.infer<typeof vcansVersionSchema>) { return this.svc.activate(actor, id, body); }
  @Post(':id/arrival-confirmation')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  confirmArrival(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(vcansVersionSchema)) body: z.infer<typeof vcansVersionSchema>) { return this.svc.confirmArrival(actor, id, body); }
  @Post(':id/lots')
  @Roles(RoleCode.QC_SUPERVISOR, RoleCode.INSPECTOR)
  addLot(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(createVcansLotSchema)) body: z.infer<typeof createVcansLotSchema>) { return this.svc.addLot(actor, id, body); }
  @Post(':id/assignment')
  @Roles(RoleCode.QC_SUPERVISOR)
  assign(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body(zod(assignVcansOrderSchema)) body: z.infer<typeof assignVcansOrderSchema>) { return this.svc.assign(actor, id, body); }
  @Post()
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  create(@CurrentActor() actor: Actor, @Body(zod(createVcansOrderSchema)) body: z.infer<typeof createVcansOrderSchema>) {
    return this.svc.create(actor, body);
  }
}
