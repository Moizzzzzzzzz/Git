import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Express } from 'express';
import { AppConfig } from './config/app-config';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';

/** 应用级中间件配置（main.ts 与集成测试共用） */
export function configureApp(app: INestApplication) {
  const config = app.get(AppConfig);
  const http = app.getHttpAdapter().getInstance() as Express;
  // 位于 Nginx 之后，信任一层代理以获得真实客户端 IP
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
  });
  app.enableShutdownHooks();
}
