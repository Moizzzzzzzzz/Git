import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { DeliveryService } from './delivery.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DeliveryProcessor, NOTIFY_QUEUE, OutboxDispatcher } from './outbox.worker';

@Global()
@Module({})
export class NotificationsModule {
  /** runWorkers=false 时不连接 Redis，只写 outbox（例如集成测试或独立 API 实例） */
  static register(opts: { runWorkers: boolean }): DynamicModule {
    const workerImports = opts.runWorkers
      ? [
          BullModule.forRootAsync({
            inject: [AppConfig],
            useFactory: (config: AppConfig) => {
              const u = new URL(config.env.REDIS_URL);
              return {
                connection: {
                  host: u.hostname,
                  port: Number(u.port || 6379),
                  password: u.password ? decodeURIComponent(u.password) : undefined,
                  db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
                },
                prefix: 'fabricqc',
              };
            },
          }),
          BullModule.registerQueue({ name: NOTIFY_QUEUE }),
        ]
      : [];
    return {
      module: NotificationsModule,
      imports: workerImports,
      controllers: [NotificationsController],
      providers: [NotificationsService, DeliveryService, ...(opts.runWorkers ? [OutboxDispatcher, DeliveryProcessor] : [])],
      exports: [NotificationsService, DeliveryService],
    };
  }
}
