import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { SerializeInterceptor } from './common/serialize.interceptor';
import { ConfigModule } from './config/config.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { HealthController } from './health/health.controller';
import { InspectionsModule } from './inspections/inspections.module';
import { MasterDataModule } from './masterdata/masterdata.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { QualityModule } from './quality/quality.module';
import { ReviewsModule } from './reviews/reviews.module';
import { RollsModule } from './rolls/rolls.module';
import { SettingsModule } from './settings/settings.module';
import { StandardsModule } from './standards/standards.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { WechatModule } from './wechat/wechat.module';

export interface AppOptions {
  runWorkers: boolean;
  /** 全局限流：每个 IP 每分钟请求数 */
  rateLimitPerMinute?: number;
  /** 仅集成测试使用：关闭限流 */
  disableRateLimit?: boolean;
}

@Module({})
export class AppModule {
  static register(opts: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule,
        PrismaModule,
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: opts.rateLimitPerMinute ?? 600 }],
          skipIf: () => opts.disableRateLimit === true,
        }),
        AuditModule,
        WechatModule,
        AuthModule,
        QualityModule,
        MediaModule,
        NotificationsModule.register({ runWorkers: opts.runWorkers }),
        UsersModule,
        MasterDataModule,
        RollsModule,
        StandardsModule,
        TasksModule,
        InspectionsModule,
        ReviewsModule,
        SettingsModule,
      ],
      controllers: [HealthController, DashboardController],
      providers: [
        // 顺序：先限流，再鉴权
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: SerializeInterceptor },
      ],
    };
  }
}
