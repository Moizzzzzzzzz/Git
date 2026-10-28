import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { addTaskRollsSchema, createTaskSchema, paginationSchema, TASK_STATUSES, updateTaskSchema } from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor, ReqMeta, type RequestMeta, Roles } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import { MANAGE_TASKS, type Actor } from '../common/actor';
import { TasksService } from './tasks.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const listQuery = paginationSchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().uuid().optional(),
});

@Controller('tasks')
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
