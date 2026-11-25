import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './app-error';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      const first = issues[0];
      throw AppError.badRequest(first ? `${first.path ? first.path + '：' : ''}${first.message}` : '参数错误', issues);
    }
    return r.data;
  }
}

/** 便捷写法：@Body(zod(schema)) */
export const zod = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);
