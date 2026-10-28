import {
  INSPECTION_STATUS_LABELS,
  JUDGE_LABELS,
  ROLL_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type InspectionStatus,
  type JudgeResult,
  type RollStatus,
  type TaskStatus,
} from '@fabricqc/shared';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/lib/hooks';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Loading({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span className="flex items-center gap-2 whitespace-pre-line">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {errorMessage(error)}
      </span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  );
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-40" />
      {text}
    </div>
  );
}

/** 统一的查询状态渲染 */
export function QueryState({
  q,
  children,
  empty,
}: {
  q: { isLoading: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
  empty?: boolean;
}) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (empty) return <Empty />;
  return <>{children}</>;
}

export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
      <span>共 {total} 条</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
          <ChevronLeft />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="下一页">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = '搜索…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <Input className="w-64" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function JudgeBadge({ value }: { value: JudgeResult | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const v = value === 'PASS' ? 'success' : value === 'FAIL' ? 'destructive' : value === 'INCONCLUSIVE' ? 'warning' : 'secondary';
  return <Badge variant={v}>{JUDGE_LABELS[value]}</Badge>;
}

export function InspectionStatusBadge({ value }: { value: InspectionStatus }) {
  const v = { DRAFT: 'secondary', SUBMITTED: 'default', RETURNED: 'warning', APPROVED: 'success', REJECTED: 'destructive', VOIDED: 'outline' } as const;
  return <Badge variant={v[value]}>{INSPECTION_STATUS_LABELS[value]}</Badge>;
}

export function RollStatusBadge({ value }: { value: RollStatus }) {
  const v = { PENDING: 'secondary', ASSIGNED: 'default', IN_INSPECTION: 'default', SUBMITTED: 'warning', RETURNED: 'warning', PASSED: 'success', FAILED: 'destructive' } as const;
  return <Badge variant={v[value]}>{ROLL_STATUS_LABELS[value]}</Badge>;
}

export function TaskStatusBadge({ value }: { value: TaskStatus }) {
  const v = { OPEN: 'secondary', IN_PROGRESS: 'default', COMPLETED: 'success', CANCELLED: 'outline' } as const;
  return <Badge variant={v[value]}>{TASK_STATUS_LABELS[value]}</Badge>;
}

export function DevDefaultBadge() {
  return (
    <Badge variant="warning" title="开发默认值：未经工厂批准，不能作为正式验收依据">
      开发默认
    </Badge>
  );
}

/** 二次确认对话框 */
export function ConfirmButton({
  children,
  title,
  description,
  onConfirm,
  variant = 'outline',
  confirmText = '确认',
  size = 'sm',
  disabled,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: 'outline' | 'destructive' | 'default' | 'ghost';
  confirmText?: string;
  size?: 'sm' | 'default';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={disabled}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={description}>
          <DialogFooter className="mt-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  /* 错误由调用方提示 */
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmText}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm">{children ?? '-'}</div>
    </div>
  );
}
