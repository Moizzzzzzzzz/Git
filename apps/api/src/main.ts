import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main() {
  // 本地开发：读取仓库根目录 .env（生产环境由 Docker 注入环境变量）
  const rootEnv = resolve(__dirname, '../../../.env');
  if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ runWorkers: env.RUN_WORKERS }), {
    bufferLogs: false,
  });
  app.useBodyParser('json', { limit: '2mb' });
  configureApp(app);
  await app.listen(env.API_PORT, '0.0.0.0');
  Logger.log(`FabricQC API listening on :${env.API_PORT} (workers: ${env.RUN_WORKERS ? 'on' : 'off'})`, 'Bootstrap');
}

void main();
