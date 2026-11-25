import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryService } from './delivery.service';

export const NOTIFY_QUEUE = 'notification-delivery';
const ATTEMPTS = 5;

/** 轮询 outbox 表，把待投递事件放入 BullMQ（jobId = outboxId 去重） */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Outbox');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFY_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 3000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM notification_outbox
          WHERE (status = 'PENDING' AND "availableAt" <= now())
             OR (status = 'ENQUEUED' AND "enqueuedAt" < now() - interval '15 minutes')
          ORDER BY "createdAt"
          LIMIT 50
          FOR UPDATE SKIP LOCKED`;
        for (const r of rows) {
          await this.queue.add(
            'deliver',
            { outboxId: r.id },
            {
              jobId: r.id,
              attempts: ATTEMPTS,
              backoff: { type: 'exponential', delay: 10_000 },
              removeOnComplete: { count: 1000 },
              removeOnFail: { count: 5000 },
            },
          );
        }
        if (rows.length) {
          await tx.notificationOutbox.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { status: 'ENQUEUED', enqueuedAt: new Date() },
          });
        }
      });
    } catch (err) {
      this.logger.warn(`outbox dispatch failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

@Processor(NOTIFY_QUEUE, { concurrency: 2 })
export class DeliveryProcessor extends WorkerHost {
  constructor(private readonly delivery: DeliveryService) {
    super();
  }

  async process(job: Job<{ outboxId: string }>) {
    await this.delivery.deliver(job.data.outboxId);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ outboxId: string }>, err: Error) {
    if (job.attemptsMade >= (job.opts.attempts ?? ATTEMPTS)) {
      await this.delivery.markFailed(job.data.outboxId, err.message);
    }
  }
}
