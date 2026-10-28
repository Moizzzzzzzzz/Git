import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode, type ApiErrorBody } from '@fabricqc/shared';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = { code: ErrorCode.INTERNAL_ERROR, message: '服务器内部错误，请稍后重试' };

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: ErrorCode.RATE_LIMITED, message: '操作过于频繁，请稍后再试' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'object' && r && 'code' in r) {
        body = r as ApiErrorBody;
      } else {
        const message = typeof r === 'string' ? r : ((r as { message?: string }).message ?? exception.message);
        const code =
          status === 404 ? ErrorCode.NOT_FOUND : status === 401 ? ErrorCode.UNAUTHENTICATED : status === 403 ? ErrorCode.FORBIDDEN : ErrorCode.VALIDATION_FAILED;
        body = { code, message: status === 404 ? '接口不存在' : String(message) };
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        body = { code: ErrorCode.CONFLICT, message: `数据重复${target ? `（${target}）` : ''}，请检查后重试` };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { code: ErrorCode.NOT_FOUND, message: '记录不存在或已被修改' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        body = { code: ErrorCode.CONFLICT, message: '关联数据不存在或仍被引用' };
      }
    }

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.originalUrl}`, (exception as Error)?.stack);
    }
    res.status(status).json({ ...body, requestId });
  }
}
