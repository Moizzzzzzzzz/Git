import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@fabricqc/shared';

/** 业务错误：统一携带错误码与中文提示 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(ErrorCode.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthenticated(message = '请先登录', code: string = ErrorCode.UNAUTHENTICATED) {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = '没有权限执行此操作') {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static notFound(what = '记录') {
    return new AppError(ErrorCode.NOT_FOUND, `${what}不存在`, HttpStatus.NOT_FOUND);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }
  static invalidState(message: string, details?: unknown) {
    return new AppError(ErrorCode.INVALID_STATE, message, HttpStatus.CONFLICT, details);
  }
  static of(code: string, message: string, status: number, details?: unknown) {
    return new AppError(code, message, status, details);
  }
}
