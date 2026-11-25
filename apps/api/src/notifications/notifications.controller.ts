import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { paginationSchema, wechatSubscribeSchema } from '@fabricqc/shared';
import { z } from 'zod';
import { CurrentActor } from '../common/decorators';
import { zod } from '../common/zod.pipe';
import type { Actor } from '../common/actor';
import { NotificationsService } from './notifications.service';

const listQuery = paginationSchema.extend({ unreadOnly: z.enum(['true', 'false']).optional() });

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentActor() a: Actor, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(a, { ...q, unreadOnly: q.unreadOnly === 'true' });
  }

  @Get('unread-count')
  unread(@CurrentActor() a: Actor) {
    return this.svc.unreadCount(a);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentActor() a: Actor) {
    return this.svc.markAllRead(a);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.svc.markRead(a, id);
  }

  @Get('wechat-subscriptions')
  subscriptions(@CurrentActor() a: Actor) {
    return this.svc.mySubscriptions(a);
  }

  @Post('wechat-subscriptions')
  @HttpCode(200)
  record(@CurrentActor() a: Actor, @Body(zod(wechatSubscribeSchema)) b: z.infer<typeof wechatSubscribeSchema>) {
    return this.svc.recordSubscriptions(a, b.results);
  }
}
