import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded, type Express } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppConfig } from './config/app-config';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { requestIdMiddleware } from './common/request-id.middleware';
import { mediaOriginMiddleware } from './media/media-origin';

/** 应用级中间件配置（main.ts 与集成测试共用） */
export function configureApp(app: INestApplication) {
  const config = app.get(AppConfig);
  const http = app.getHttpAdapter().getInstance() as Express;
  // 位于 Nginx 之后，信任一层代理以获得真实客户端 IP
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(mediaOriginMiddleware);
  app.use('/api/review-access', (_req:Request,res:Response,next:NextFunction)=>{res.setHeader('Cache-Control','no-store, private');next();});
  // VCANS files are base64-encoded; only this route gets a bounded larger JSON body.
  app.use('/api/orders/import/preview', json({ limit: '7mb' }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
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
