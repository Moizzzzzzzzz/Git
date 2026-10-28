import { Injectable, Logger } from '@nestjs/common';
import { DECISION_LABELS, JUDGE_LABELS } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { WechatApiError, WechatGateway } from '../wechat/wechat.gateway';
import { buildTemplateData } from './message-format';
import { OutboxEvent } from './notifications.service';

interface Payload {
  inspectionId: string;
  revision: number;
  reviewId?: string;
  recipientIds: string[];
}

interface Message {
  templateId: string | undefined;
  mapping: Record<string, string>;
  page: string;
  values: Record<string, string | Date | null>;
}

/** 可重试的临时错误（网络、微信系统繁忙） */
export class TransientDeliveryError extends Error {}

/**
 * 投递 outbox 事件。站内通知已在业务事务中写入，这里只处理外部渠道（微信订阅消息）。
 * 任何渠道失败都不会影响质检数据和站内待办。
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechat: WechatGateway,
    private readonly config: AppConfig,
  ) {}

  private async buildMessage(eventType: string, p: Payload): Promise<Message | null> {
    const i = await this.prisma.rollInspection.findUnique({
      where: { id: p.inspectionId },
      include: {
        roll: { include: { fabric: true } },
        inspector: true,
        reviews: { where: { revision: p.revision }, include: { reviewer: true } },
      },
    });
    if (!i) return null;
    const e = this.config.env;
    if (eventType === OutboxEvent.REVIEW_REQUESTED) {
      return {
        templateId: e.WECHAT_TPL_REVIEW_REQUEST,
        mapping: e.WECHAT_TPL_REVIEW_REQUEST_FIELDS,
        page: `pages/review/detail?id=${i.id}`,
        values: {
          rollNo: i.roll.rollNo,
          fabricName: `${i.roll.fabric.code} ${i.roll.fabric.nameZh}`,
          inspectorName: i.inspector.name,
          overallResult: i.overallResult ? JUDGE_LABELS[i.overallResult] : '-',
          submittedAt: i.submittedAt,
        },
      };
    }
    if (eventType === OutboxEvent.REVIEW_DECIDED) {
      const review = i.reviews[0];
      if (!review) return null;
      return {
        templateId: e.WECHAT_TPL_REVIEW_RESULT,
        mapping: e.WECHAT_TPL_REVIEW_RESULT_FIELDS,
        page: review.decision === 'RETURN' ? `pages/inspect/index?id=${i.id}` : `pages/review/detail?id=${i.id}`,
        values: {
          rollNo: i.roll.rollNo,
          decision: DECISION_LABELS[review.decision],
          reviewerName: review.reviewer.name,
          comment: review.comment ?? '无',
          decidedAt: review.createdAt,
        },
      };
    }
    return null;
  }

  private async record(outboxId: string, userId: string, status: 'SENT' | 'FAILED' | 'SKIPPED', templateId: string | null, errorCode?: string, errorMessage?: string) {
    await this.prisma.notificationDelivery.create({
      data: { outboxId, userId, channel: 'WECHAT_SUBSCRIBE', status, templateId, errorCode, errorMessage: errorMessage?.slice(0, 500) },
    });
  }

  async deliver(outboxId: string): Promise<void> {
    const ob = await this.prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    if (!ob || ob.status === 'DONE' || ob.status === 'FAILED') return;
    await this.prisma.notificationOutbox.update({ where: { id: outboxId }, data: { attempts: { increment: 1 } } });
    const payload = ob.payload as unknown as Payload;
    const msg = await this.buildMessage(ob.eventType, payload);

    for (const userId of payload.recipientIds ?? []) {
      const done = await this.prisma.notificationDelivery.findFirst({
        where: { outboxId, userId, channel: 'WECHAT_SUBSCRIBE', status: { in: ['SENT', 'SKIPPED'] } },
      });
      if (done) continue;
      if (!msg) {
        await this.record(outboxId, userId, 'SKIPPED', null, 'NO_MESSAGE', '事件数据不存在');
        continue;
      }
      if (!this.wechat.configured) {
        await this.record(outboxId, userId, 'SKIPPED', null, 'WECHAT_NOT_CONFIGURED');
        continue;
      }
      if (!msg.templateId) {
        await this.record(outboxId, userId, 'SKIPPED', null, 'TEMPLATE_NOT_CONFIGURED');
        continue;
      }
      const identity = await this.prisma.wechatIdentity.findFirst({ where: { userId, appId: this.wechat.appId ?? '' } });
      if (!identity) {
        await this.record(outboxId, userId, 'SKIPPED', msg.templateId, 'NOT_BOUND');
        continue;
      }
      // 原子扣减一次授权；没有余量则跳过（不能假设可以无限次发送）
      const quota = await this.prisma.wechatSubscription.updateMany({
        where: { userId, templateId: msg.templateId, remaining: { gt: 0 } },
        data: { remaining: { decrement: 1 } },
      });
      if (quota.count !== 1) {
        await this.record(outboxId, userId, 'SKIPPED', msg.templateId, 'NO_CONSENT');
        continue;
      }
      try {
        await this.wechat.sendSubscribeMessage({
          openId: identity.openId,
          templateId: msg.templateId,
          page: msg.page,
          data: buildTemplateData(msg.mapping, msg.values),
        });
        await this.record(outboxId, userId, 'SENT', msg.templateId);
      } catch (err) {
        if (err instanceof WechatApiError) {
          if (err.errcode === 43101) {
            // 用户拒绝或授权已用完：清零余量，不再重试
            await this.prisma.wechatSubscription.updateMany({ where: { userId, templateId: msg.templateId }, data: { remaining: 0 } });
            await this.record(outboxId, userId, 'FAILED', msg.templateId, String(err.errcode), err.errmsg);
            continue;
          }
          // 发送失败未消耗授权，退还
          await this.refund(userId, msg.templateId);
          if (err.errcode === -1 || err.errcode === 45009) throw new TransientDeliveryError(err.message);
          await this.record(outboxId, userId, 'FAILED', msg.templateId, String(err.errcode), err.errmsg);
          continue;
        }
        await this.refund(userId, msg.templateId);
        this.logger.warn(`wechat send network error: ${(err as Error).message}`);
        throw new TransientDeliveryError((err as Error).message);
      }
    }
    await this.prisma.notificationOutbox.update({ where: { id: outboxId }, data: { status: 'DONE', processedAt: new Date(), lastError: null } });
  }

  private async refund(userId: string, templateId: string) {
    await this.prisma.wechatSubscription.updateMany({ where: { userId, templateId }, data: { remaining: { increment: 1 } } });
  }

  async markFailed(outboxId: string, error: string) {
    await this.prisma.notificationOutbox.updateMany({
      where: { id: outboxId, status: { not: 'DONE' } },
      data: { status: 'FAILED', lastError: error.slice(0, 1000), processedAt: new Date() },
    });
  }
}
