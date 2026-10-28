import { MODE_LABELS, SCOPE_LABELS, type InspectionStatus, type JudgeResult, type RollStatus, type TaskRollStatus } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmButton, InspectionStatusBadge, JudgeBadge, KV, PageHeader, QueryState, RollStatusBadge, TaskStatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtDate, fmtNum } from '@/lib/utils';
import { usePeople, type TaskRow } from './TasksPage';

interface TaskDetail extends Omit<TaskRow, 'rollCount' | 'doneCount' | 'submittedCount'> {
  rolls: {
    taskRollId: string;
    status: TaskRollStatus;
    roll: { id: string; rollNo: string; status: RollStatus; nominalLengthM: number | null; dyeLotNo: string | null; lot: { lotNo: string } | null; fabric: { code: string; nameZh: string } };
    latestInspection: { id: string; inspectionNo: string; status: InspectionStatus; overallResult: JudgeResult | null; revision: number; submittedAt: string | null } | null;
  }[];
}

export function TaskDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const manage = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR');
  const q = useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`) });
  const [reassign, setReassign] = useState(false);
  const cancel = useAction(() => api.put(`/tasks/${id}`, { status: 'CANCELLED' }), {
    success: '任务已取消，未完成的布卷已回到待分配',
    invalidate: [['task', id], ['tasks']],
  });
  const t = q.data;
  const active = t && (t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  return (
    <>
      <PageHeader
        title={t ? `${t.taskNo} · ${t.title}` : '任务详情'}
        actions={
          <>
            <Button variant="outline" asChild><Link to="/tasks"><ArrowLeft /> 返回</Link></Button>
            {manage && active && <Button variant="outline" onClick={() => setReassign(true)}>更换质检员</Button>}
            {manage && active && (
              <ConfirmButton variant="destructive" size="default" title="取消该任务？" description="进行中的草稿将作废，未完成的布卷回到待分配状态。已有待审核记录时不能取消。" onConfirm={() => cancel.mutateAsync(undefined)}>
                取消任务
              </ConfirmButton>
            )}
          </>
        }
      />
      <QueryState q={q}>
        {t && (
          <div className="space-y-5">
            <Card>
              <CardContent className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
                <KV label="状态"><TaskStatusBadge value={t.status} /></KV>
                <KV label="质检员">{t.assignee.name}（{t.assignee.employeeNo}）</KV>
                <KV label="审核人">{t.reviewer?.name ?? '自动路由'}</KV>
                <KV label="部门">{t.department?.name ?? '-'}</KV>
                <KV label="四分制标准">{t.fourPointStandard.name}</KV>
                <KV label="客户标准">{t.customerStandard?.name ?? '-'}</KV>
                <KV label="检验模板">{t.template.name}</KV>
                <KV label="建议方式 / 范围">{t.defaultMode ? MODE_LABELS[t.defaultMode] : '现场选择'} · {SCOPE_LABELS[t.defaultScope]}</KV>
                <KV label="创建人">{t.createdBy.name}</KV>
                <KV label="创建时间">{fmtDate(t.createdAt)}</KV>
                <KV label="截止">{fmtDate(t.dueAt, false)}</KV>
                <KV label="备注">{t.notes ?? '-'}</KV>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>布卷（{t.rolls.length}）</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR><TH>卷号</TH><TH>批号 / 缸号</TH><TH>标称长度</TH><TH>布卷状态</TH><TH>最新检验</TH><TH>系统判定</TH><TH>提交时间</TH><TH /></TR>
                  </THead>
                  <TBody>
                    {t.rolls.map((r) => (
                      <TR key={r.taskRollId}>
                        <TD className="font-medium">{r.roll.rollNo}</TD>
                        <TD>{r.roll.lot?.lotNo ?? '-'} / {r.roll.dyeLotNo ?? '-'}</TD>
                        <TD className="tabular-nums">{fmtNum(r.roll.nominalLengthM)} m</TD>
                        <TD><RollStatusBadge value={r.roll.status} /></TD>
                        <TD>{r.latestInspection ? <InspectionStatusBadge value={r.latestInspection.status} /> : <span className="text-muted-foreground">未开始</span>}</TD>
                        <TD><JudgeBadge value={r.latestInspection?.overallResult} /></TD>
                        <TD className="text-muted-foreground">{fmtDate(r.latestInspection?.submittedAt)}</TD>
                        <TD className="text-right">
                          {r.latestInspection && (
                            <Button asChild size="sm" variant="outline"><Link to={`/inspections/${r.latestInspection.id}`}>查看</Link></Button>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
      {reassign && t && <ReassignDialog taskId={t.id} current={t.assignee.id} onClose={() => setReassign(false)} />}
    </>
  );
}

function ReassignDialog({ taskId, current, onClose }: { taskId: string; current: string; onClose: () => void }) {
  const inspectors = usePeople('INSPECTOR');
  const [assigneeId, setAssigneeId] = useState(current);
  const save = useAction(() => api.put(`/tasks/${taskId}`, { assigneeId }), {
    success: '已更换质检员',
    invalidate: [['task', taskId], ['tasks']],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="更换质检员" description="仅在没有进行中检验草稿时可以更换">
        <Field label="质检员">
          <NativeSelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {inspectors.data?.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.employeeNo}）</option>)}
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button loading={save.isPending} disabled={assigneeId === current} onClick={() => save.mutate(undefined)}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
