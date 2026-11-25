import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { addTaskRollsSchema, createBusinessTaskSchema, createTaskSchema, externalTaskSchema, paginationSchema, TASK_STATUSES, updateTaskSchema } from '@fabricqc/shared';
import { z } from 'zod';
import { RoleCode } from '@fabricqc/shared';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { MANAGE_TASKS, type Actor } from '../common/actor';
import { TasksService } from './tasks.service';
import { TaskPurposeGuard } from '../vcans-orders/test-purpose.guard';

const uuid = new ParseUUIDPipe({ version: '4' });
const listQuery = paginationSchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().uuid().optional(),
});

@Controller('tasks')
@UseGuards(TaskPurposeGuard)
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(a, q);
  }

  @Get('mine')
  mine(@CurrentActor() a: Actor) {
    return this.svc.mine(a);
  }

  @Get('external/reviewers')
  @Roles(RoleCode.INSPECTOR)
  reviewers(@CurrentActor() a: Actor) { return this.svc.externalReviewers(a); }

  @Post('external')
  @Roles(RoleCode.INSPECTOR)
  createExternal(@CurrentActor() a: Actor, @Body(zod(externalTaskSchema)) b: z.infer<typeof externalTaskSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createExternal(a, b, m);
  }

  @Get('business/options')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  businessOptions(@CurrentActor() a: Actor) { return this.svc.businessOptions(a); }

  @Get('business')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  listBusiness(@CurrentActor() a: Actor) { return this.svc.listBusiness(a); }

  @Post('business')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  createBusiness(@CurrentActor() a: Actor, @Body(zod(createBusinessTaskSchema)) b: z.infer<typeof createBusinessTaskSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createBusiness(a, b, m);
  }

  @Post(':id/delivery')
  @Roles(RoleCode.QC_SUPERVISOR)
  confirmDelivery(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { return this.svc.confirmDelivery(a, id, m); }

  @Get(':id/notification-status')
  @Roles(RoleCode.SALES)
  notificationStatus(@CurrentActor() a: Actor, @Param('id', uuid) id: string) { return this.svc.businessNotificationStatus(a, id); }

  @Get(':id/delivery')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  getDelivery(@CurrentActor() a: Actor, @Param('id', uuid) id: string) { return this.svc.getDelivery(a, id); }

  @Get(':id/business-progress')
  @Roles(RoleCode.SALES, RoleCode.BUSINESS_MANAGER, RoleCode.BUSINESS_CLERK)
  businessProgress(@CurrentActor() a: Actor, @Param('id', uuid) id: string) { return this.svc.businessProgress(a, id); }

  @Post(':id/reminders')
  @Roles(RoleCode.SALES)
  remind(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @Body(zod(z.object({ idempotencyKey: z.string().uuid() }).strict())) b: { idempotencyKey: string }, @ReqMeta() m: RequestMeta) {
    return this.svc.remindBusiness(a, id, b.idempotencyKey, m);
  }

  @Post(':id/rolls/register')
  @Roles(RoleCode.INSPECTOR)
  registerBusinessRolls(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @Body(zod(z.object({ fabricId: z.string().uuid(), rolls: z.array(z.object({ rollNo: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_\-./]+$/), nominalLengthM: z.number().positive().max(100000).optional().nullable() }).strict()).min(1).max(100) }).strict())) b: { fabricId: string; rolls: { rollNo: string; nominalLengthM?: number | null }[] }, @ReqMeta() m: RequestMeta) {
    return this.svc.registerBusinessRolls(a, id, b, m);
  }

  @Post(':id/assignment')
  @Roles(RoleCode.QC_SUPERVISOR)
  assignBusiness(@CurrentActor() a: Actor, @Param('id', uuid) id: string, @Body(zod(z.object({ assigneeId: z.string().uuid(), reason: z.string().trim().max(500).optional() }).strict())) b: { assigneeId: string; reason?: string }, @ReqMeta() m: RequestMeta) {
    return this.svc.assignBusiness(a, id, b, m);
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', uuid) id: string) {
    return this.svc.get(a, id);
  }

  @Post()
  @Roles(...MANAGE_TASKS)
  create(@CurrentActor() a: Actor, @Body(zod(createTaskSchema)) b: z.infer<typeof createTaskSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.create(a, b, m);
  }

  @Put(':id')
  @Roles(...MANAGE_TASKS)
  update(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(updateTaskSchema)) b: z.infer<typeof updateTaskSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.update(a, id, b, m);
  }

  @Post(':id/rolls')
  @Roles(...MANAGE_TASKS)
  @HttpCode(200)
  addRolls(
    @CurrentActor() a: Actor,
    @Param('id', uuid) id: string,
    @Body(zod(addTaskRollsSchema)) b: z.infer<typeof addTaskRollsSchema>,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.addRolls(a, id, b.rollIds, m);
  }
}
