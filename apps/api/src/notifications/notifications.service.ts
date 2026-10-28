import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Pagination } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import type { Actor } from '../common/actor';
import { pageArgs, paged } from '../common/pagination';

export const OutboxEvent = {
  REVIEW_REQUESTED: 'REVIEW_REQUESTED',
  REVIEW_DECIDED: 'REVIEW_DECIDED',
} as const;
export type OutboxEvent = (typeof OutboxEvent)[keyof typeof OutboxEvent];

export interface InAppInput {
  userIds: string[];
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  pagePath?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** 站内通知（与业务同事务写入，立即可见） */
  async notifyInApp(tx: Tx, n: InAppInput) {
    if (!n.userIds.length) return;
    await tx.notification.createMany({
      data: n.userIds.map((userId) => ({
        userId,
        type: n.type,
        title: n.title,
        body: n.body,
        entityType: n.entityType,
        entityId: n.entityId,
        pagePath: n.pagePath,
      })),
    });
  }

  /** Transactional Outbox：必须在业务事务内调用；dedupeKey 保证同一事件只入队一次 */
  async enqueue(tx: Tx, eventType: OutboxEvent, dedupeKey: string, payload: Record<string, unknown>) {
    await tx.notificationOutbox.create({
      data: { eventType, dedupeKey, payload: payload as Prisma.InputJsonValue },
    });
  }

  async list(actor: Actor, p: Pagination & { unreadOnly?: boolean }) {
    const where: Prisma.NotificationWhereInput = { userId: actor.userId, ...(p.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(p) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);
    return { ...paged(items, total, p), unread };
  }

  async unreadCount(actor: Actor) {
    return { unread: await this.prisma.notification.count({ where: { userId: actor.userId, readAt: null } }) };
  }

  async markRead(actor: Actor, id: string) {
    const r = await this.prisma.notification.updateMany({
      where: { id, userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!r.count && !(await this.prisma.notification.findFirst({ where: { id, userId: actor.userId } }))) {
      throw AppError.notFound('通知');
    }
    return { ok: true };
  }

  async markAllRead(actor: Actor) {
    const r = await this.prisma.notification.updateMany({
      where: { userId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }

  /** 小程序需要申请授权的订阅消息模板（只返回已配置的模板 ID） */
  wechatTemplates() {
    const e = this.config.env;
    return {
      reviewRequest: e.WECHAT_TPL_REVIEW_REQUEST ?? null,
      reviewResult: e.WECHAT_TPL_REVIEW_RESULT ?? null,
    };
  }

  /**
   * 记录用户在 wx.requestSubscribeMessage 中的选择。
   * 一次性订阅：每次"允许"获得一次发送机会，累加到 remaining。
   */
  async recordSubscriptions(actor: Actor, results: { templateId: string; accepted: boolean }[]) {
    const allowed = new Set(Object.values(this.wechatTemplates()).filter((v): v is string => !!v));
    const out: { templateId: string; remaining: number }[] = [];
    for (const r of results) {
      if (!allowed.has(r.templateId)) continue;
      if (!r.accepted) continue;
      const row = await this.prisma.wechatSubscription.upsert({
        where: { userId_templateId: { userId: actor.userId, templateId: r.templateId } },
        create: { userId: actor.userId, templateId: r.templateId, remaining: 1, lastAcceptedAt: new Date() },
        // 设置上限，避免客户端异常重复上报导致计数失真
        update: { remaining: { increment: 1 }, lastAcceptedAt: new Date() },
      });
      if (row.remaining > 50) {
        await this.prisma.wechatSubscription.update({ where: { id: row.id }, data: { remaining: 50 } });
        row.remaining = 50;
      }
      out.push({ templateId: r.templateId, remaining: row.remaining });
    }
    return { subscriptions: out };
  }

  async mySubscriptions(actor: Actor) {
    const rows = await this.prisma.wechatSubscription.findMany({ where: { userId: actor.userId } });
    return { templates: this.wechatTemplates(), subscriptions: rows.map((r) => ({ templateId: r.templateId, remaining: r.remaining })) };
  }
}
