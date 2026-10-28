import { ROLL_STATUS_LABELS, TASK_STATUS_LABELS, type InspectionStatus, type JudgeResult, type RollStatus, type TaskStatus } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { InspectionStatusBadge, JudgeBadge, PageHeader, QueryState } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';

interface Summary {
  rollsByStatus: Partial<Record<RollStatus, number>>;
  tasksByStatus: Partial<Record<TaskStatus, number>>;
  submittedToday: number;
  pendingReviews: number;
  myPendingReviews: number;
  decided30Days: Partial<Record<'APPROVED' | 'REJECTED', number>>;
  recent: {
    id: string;
    inspectionNo: string;
    status: InspectionStatus;
    overallResult: JudgeResult | null;
    submittedAt: string;
    roll: { rollNo: string; fabric: { code: string; nameZh: string } };
    inspector: { name: string };
  }[];
}

function Stat({ label, value, hint, to }: { label: string; value: number | string; hint?: string; to?: string }) {
  const body = (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Summary>('/dashboard/summary'), refetchInterval: 60_000 });
  const d = q.data;
  const approved = d?.decided30Days.APPROVED ?? 0;
  const rejected = d?.decided30Days.REJECTED ?? 0;
  return (
    <>
      <PageHeader title={`你好，${me?.name}`} description="今日验布概况" />
      <QueryState q={q}>
        {d && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="待审核" value={d.pendingReviews} hint={`其中分配给我 ${d.myPendingReviews} 条`} to="/reviews" />
              <Stat label="今日提交检验" value={d.submittedToday} to="/inspections" />
              <Stat label="进行中任务" value={(d.tasksByStatus.OPEN ?? 0) + (d.tasksByStatus.IN_PROGRESS ?? 0)} to="/tasks" />
              <Stat
                label="近 30 天审核"
                value={approved + rejected}
                hint={`通过 ${approved} · 判定不合格 ${rejected}`}
              />
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>最近提交</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>卷号</TH>
                        <TH>面料</TH>
                        <TH>质检员</TH>
                        <TH>系统判定</TH>
                        <TH>状态</TH>
                        <TH>提交时间</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {d.recent.map((r) => (
                        <TR key={r.id}>
                          <TD>
                            <Link className="font-medium text-primary hover:underline" to={`/inspections/${r.id}`}>
                              {r.roll.rollNo}
                            </Link>
                          </TD>
                          <TD>{r.roll.fabric.code}</TD>
                          <TD>{r.inspector.name}</TD>
                          <TD>
                            <JudgeBadge value={r.overallResult} />
                          </TD>
                          <TD>
                            <InspectionStatusBadge value={r.status} />
                          </TD>
                          <TD className="text-muted-foreground">{fmtDate(r.submittedAt)}</TD>
                        </TR>
                      ))}
                      {!d.recent.length && (
                        <TR>
                          <TD colSpan={6} className="py-8 text-center text-muted-foreground">
                            暂无提交记录
                          </TD>
                        </TR>
                      )}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>布卷状态</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(Object.keys(ROLL_STATUS_LABELS) as RollStatus[]).map((s) => (
                    <div key={s} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{ROLL_STATUS_LABELS[s]}</span>
                      <span className="font-medium tabular-nums">{d.rollsByStatus[s] ?? 0}</span>
                    </div>
                  ))}
                  <div className="my-2 h-px bg-border" />
                  {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
                    <div key={s} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">任务 · {TASK_STATUS_LABELS[s]}</span>
                      <span className="font-medium tabular-nums">{d.tasksByStatus[s] ?? 0}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
