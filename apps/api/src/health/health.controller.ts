import { Controller, Get, HttpStatus, OnModuleDestroy, Res } from '@nestjs/common';
import Redis from 'ioredis';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators';

@Controller('health')
export class HealthController implements OnModuleDestroy {
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  private async pingRedis(): Promise<'ok' | 'down' | 'disabled'> {
    if (!this.config.env.RUN_WORKERS) return 'disabled';
    try {
      this.redis ??= new Redis(this.config.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
      if (this.redis.status === 'wait') await this.redis.connect();
      return (await this.redis.ping()) === 'PONG' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let db: 'ok' | 'down' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    const redis = await this.pingRedis();
    const status = db === 'ok' && redis !== 'down' ? 'ok' : db === 'ok' ? 'degraded' : 'down';
    if (db === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status, db, redis, time: new Date().toISOString(), version: process.env.APP_VERSION ?? '0.1.0' };
  }
}
