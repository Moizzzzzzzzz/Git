import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENGINE_VERSION } from '@fabricqc/quality-engine';
import type { z } from 'zod';
import type { systemSettingsSchema } from '@fabricqc/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../common/actor';
import type { RequestMeta } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { StorageAdapter } from '../media/storage.adapter';
import { WechatGateway } from '../wechat/wechat.gateway';

type SettingsIn = z.infer<typeof systemSettingsSchema>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly wechat: WechatGateway,
    private readonly storage: StorageAdapter,
  ) {}

  async get() {
    const rows = await this.prisma.systemSetting.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const e = this.config.env;
    return {
      settings: {
        companyName: (map.companyName as string | undefined) ?? 'FabricQC',
        bindCodeTtlHours: (map.bindCodeTtlHours as number | undefined) ?? e.BIND_CODE_TTL_HOURS,
      },
      // 只返回"是否已配置"，绝不返回密钥
      system: {
        environment: e.NODE_ENV,
        engineVersion: ENGINE_VERSION,
        wechatConfigured: this.wechat.configured,
        wechatAppId: e.WECHAT_APP_ID ?? null,
        reviewRequestTemplateConfigured: Boolean(e.WECHAT_TPL_REVIEW_REQUEST),
        reviewResultTemplateConfigured: Boolean(e.WECHAT_TPL_REVIEW_RESULT),
        storageConfigured: this.storage.configured,
        storageProvider: e.STORAGE_PROVIDER,
        storageBucket: e.STORAGE_BUCKET ?? null,
        qrBaseUrl: e.QR_BASE_URL,
        workersEnabled: e.RUN_WORKERS,
        accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
        refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
        bindCodeMaxAttempts: e.BIND_CODE_MAX_ATTEMPTS,
        loginMaxFailures: e.LOGIN_MAX_FAILURES,
        loginLockMinutes: e.LOGIN_LOCK_MINUTES,
      },
    };
  }

  async update(actor: Actor, d: SettingsIn, meta: RequestMeta) {
    const before = await this.get();
    for (const [key, value] of Object.entries(d)) {
      if (value === undefined) continue;
      await this.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.userId },
        update: { value: value as Prisma.InputJsonValue, updatedById: actor.userId },
      });
    }
    const after = await this.get();
    await this.audit.log(actor, { action: 'settings.update', entityType: 'SystemSetting', before: before.settings, after: after.settings }, meta);
    return after;
  }
}
