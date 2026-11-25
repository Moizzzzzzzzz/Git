import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from './api';

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const problems = (e.details as { problems?: string[] } | undefined)?.problems;
    if (problems?.length) return `${e.message}：${problems.join('；')}`;
    const rows = Array.isArray(e.details) ? (e.details as { row?: number; message?: string }[]) : null;
    if (rows?.length && rows[0]?.row !== undefined) {
      return `${e.message}\n${rows.slice(0, 8).map((r) => `第 ${r.row} 行：${r.message}`).join('\n')}`;
    }
    return e.message;
  }
  return (e as Error)?.message ?? '操作失败';
}

/** 带成功提示、错误提示、自动刷新缓存的 mutation */
export function useAction<TVars, TResult = unknown>(
  fn: (v: TVars) => Promise<TResult>,
  opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      opts.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
