import { INSPECTION_MODES, INSPECTION_SCOPES, MODE_LABELS, SCOPE_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, type InspectionMode, type InspectionScope, type TaskStatus } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, Pager, QueryState, SearchBox, TaskStatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtDate, fmtNum } from '@/lib/utils';
import { useStandards, useTemplates } from './FabricsPage';
import { useFabricOptions, type RollRow } from './RollsPage';
import { useDepartments } from './UsersPage';

interface Person {
  id: string;
  name: string;
  employeeNo: string;
}

export interface TaskRow {
  id: string;
  taskNo: string;
  title: string;
  status: TaskStatus;
  defaultMode: InspectionMode | null;
  defaultScope: InspectionScope;
  dueAt: string | null;
  notes: string | null;
  createdAt: string;
  assignee: Person;
  reviewer: Person | null;
  createdBy: Person;
  department: { name: string } | null;
  customer: { name: string } | null;
  fourPointStandard: { id: string; name: string };
  customerStandard: { id: string; name: string } | null;
  template: { id: string; name: string };
  rollCount: number;
  doneCount: number;
  submittedCount: number;
}

export function usePeople(role: string) {
  return useQuery({ queryKey: ['users', 'options', role], queryFn: () => api.get<Person[]>(`/users/options?role=${role}`) });
}

export function TasksPage() {
  const { can } = useAuth();
  const manage = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['tasks', page, q, status],
    queryFn: () => api.get<Paged<TaskRow>>(`/tasks${qs({ page, pageSize: 20, q, status })}`),
  });
  return (
    <>
      <PageHeader
        title="验布任务"
        description="创建任务、分配质检员，任务中的布卷会出现在质检员的小程序里"
        actions={manage && <Button onClick={() => setCreating(true)}><Plus /> 创建任务</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="任务号 / 标题" />
          <NativeSelect className="w-32" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
          </NativeSelect>
        </div>
        <QueryState q={list}>
          <Table>
            <THead>
              <TR><TH>任务号</TH><TH>标题</TH><TH>质检员</TH><TH>审核人</TH><TH>进度</TH><TH>标准</TH><TH>状态</TH><TH>截止</TH></TR>
            </THead>
            <TBody>
              {list.data?.items.map((t) => (
                <TR key={t.id}>
                  <TD><Link className="font-medium text-primary hover:underline" to={`/tasks/${t.id}`}>{t.taskNo}</Link></TD>
                  <TD>{t.title}</TD>
                  <TD>{t.assignee.name}</TD>
                  <TD>{t.reviewer?.name ?? <span className="text-muted-foreground">自动路由</span>}</TD>
                  <TD className="tabular-nums">
                    {t.doneCount}/{t.rollCount}
                    {t.submittedCount > 0 && <span className="ml-1 text-xs text-amber-700">（{t.submittedCount} 待审）</span>}
                  </TD>
                  <TD className="text-xs text-muted-foreground">{t.fourPointStandard.name}{t.customerStandard && <div>{t.customerStandard.name}</div>}</TD>
                  <TD><TaskStatusBadge value={t.status} /></TD>
                  <TD className="text-muted-foreground">{fmtDate(t.dueAt, false)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
      {creating && <CreateTaskDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateTaskDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const fabrics = useFabricOptions();
  const standards = useStandards();
  const templates = useTemplates();
  const inspectors = usePeople('INSPECTOR');
  const supervisors = usePeople('QC_SUPERVISOR');
  const managers = usePeople('QUALITY_MANAGER');
  const depts = useDepartments();
  const [fabricId, setFabricId] = useState('');
  const [rollQ, setRollQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [f, setF] = useState({
    title: '',
    assigneeId: '',
    reviewerId: '',
    departmentId: '',
    defaultMode: '',
    defaultScope: 'FULL' as InspectionScope,
    fourPointStandardId: '',
    customerStandardId: '',
    templateId: '',
    dueAt: '',
    notes: '',
  });
  const rolls = useQuery({
    queryKey: ['rolls', 'pending', fabricId, rollQ],
    queryFn: () => api.get<Paged<RollRow>>(`/rolls${qs({ status: 'PENDING', fabricId, q: rollQ, pageSize: 200 })}`),
    enabled: !!fabricId,
  });
  const reviewers = useMemo(() => {
    const m = new Map<string, Person>();
    [...(supervisors.data ?? []), ...(managers.data ?? [])].forEach((p) => m.set(p.id, p));
    return [...m.values()];
  }, [supervisors.data, managers.data]);

  function chooseFabric(id: string) {
    setFabricId(id);
    setPicked(new Set());
    const fab = fabrics.data?.find((x) => x.id === id);
    if (fab) {
      setF((cur) => ({
        ...cur,
        title: cur.title || `${fab.code} 验布`,
        fourPointStandardId: fab.defaultFourPointStandard?.id ?? cur.fourPointStandardId,
        customerStandardId: fab.defaultCustomerStandard?.id ?? '',
        templateId: fab.defaultTemplate?.id ?? cur.templateId,
      }));
    }
  }

  const save = useAction(
    () =>
      api.post<{ id: string }>('/tasks', {
        ...f,
        reviewerId: f.reviewerId || null,
        departmentId: f.departmentId || null,
        defaultMode: f.defaultMode || null,
        customerStandardId: f.customerStandardId || null,
        dueAt: f.dueAt ? new Date(`${f.dueAt}T23:59:59+08:00`).toISOString() : null,
        rollIds: [...picked],
      }),
    { success: '任务已创建并通知质检员', invalidate: [['tasks'], ['rolls']], onSuccess: (r) => navigate(`/tasks/${r.id}`) },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const fp = standards.data?.filter((x) => x.kind === 'FOUR_POINT' && x.currentVersion) ?? [];
  const cs = standards.data?.filter((x) => x.kind === 'CUSTOMER' && x.currentVersion) ?? [];
  const items = rolls.data?.items ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="创建验布任务" wide>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="面料" required>
            <NativeSelect value={fabricId} onChange={(e) => chooseFabric(e.target.value)}>
              <option value="">请选择面料</option>
              {fabrics.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.nameZh}</option>)}
            </NativeSelect>
          </Field>
          <Field label="任务标题" required className="md:col-span-2"><Input value={f.title} onChange={set('title')} /></Field>
          <Field label="质检员" required>
            <NativeSelect value={f.assigneeId} onChange={set('assigneeId')}>
              <option value="">请选择</option>
              {inspectors.data?.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.employeeNo}）</option>)}
            </NativeSelect>
          </Field>
          <Field label="指定审核人" hint="不指定则按直属主管 → 部门主管 → 质量经理自动路由">
            <NativeSelect value={f.reviewerId} onChange={set('reviewerId')}>
              <option value="">自动路由</option>
              {reviewers.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.employeeNo}）</option>)}
            </NativeSelect>
          </Field>
          <Field label="所属部门" hint="默认取质检员部门">
            <NativeSelect value={f.departmentId} onChange={set('departmentId')}>
              <option value="">默认</option>
              {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="四分制标准" required>
            <NativeSelect value={f.fourPointStandardId} onChange={set('fourPointStandardId')}>
              <option value="">请选择</option>
              {fp.map((x) => <option key={x.id} value={x.id}>{x.name} v{x.currentVersion?.version}</option>)}
            </NativeSelect>
          </Field>
          <Field label="客户标准">
            <NativeSelect value={f.customerStandardId} onChange={set('customerStandardId')}>
              <option value="">无</option>
              {cs.map((x) => <option key={x.id} value={x.id}>{x.name} v{x.currentVersion?.version}</option>)}
            </NativeSelect>
          </Field>
          <Field label="检验模板" required>
            <NativeSelect value={f.templateId} onChange={set('templateId')}>
              <option value="">请选择</option>
              {templates.data?.filter((t) => t.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="建议检验方式">
            <NativeSelect value={f.defaultMode} onChange={set('defaultMode')}>
              <option value="">现场选择</option>
              {INSPECTION_MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="建议检验范围">
            <NativeSelect value={f.defaultScope} onChange={set('defaultScope')}>
              {INSPECTION_SCOPES.map((m) => <option key={m} value={m}>{SCOPE_LABELS[m]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="截止日期"><Input type="date" value={f.dueAt} onChange={set('dueAt')} /></Field>
          <Field label="备注" className="md:col-span-3"><Textarea value={f.notes} onChange={set('notes')} /></Field>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">选择布卷（仅显示待分配）· 已选 {picked.size}</div>
            <div className="flex items-center gap-2">
              <Input className="h-8 w-48" placeholder="筛选卷号 / 缸号" value={rollQ} onChange={(e) => setRollQ(e.target.value)} disabled={!fabricId} />
              <Button size="sm" variant="outline" disabled={!items.length} onClick={() => setPicked(new Set(items.map((r) => r.id)))}>全选</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>清空</Button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto rounded border">
            {!fabricId ? (
              <p className="p-4 text-sm text-muted-foreground">请先选择面料</p>
            ) : (
              <Table>
                <TBody>
                  {items.map((r) => (
                    <TR key={r.id}>
                      <TD className="w-8">
                        <Checkbox
                          checked={picked.has(r.id)}
                          onChange={(e) => {
                            const s = new Set(picked);
                            if (e.target.checked) s.add(r.id);
                            else s.delete(r.id);
                            setPicked(s);
                          }}
                        />
                      </TD>
                      <TD className="font-medium">{r.rollNo}</TD>
                      <TD>{r.lot?.lotNo ?? '-'} / {r.dyeLotNo ?? '-'}</TD>
                      <TD className="tabular-nums">{fmtNum(r.nominalLengthM)} m</TD>
                    </TR>
                  ))}
                  {!items.length && (
                    <TR><TD className="py-6 text-center text-muted-foreground">该面料没有待分配的布卷</TD></TR>
                  )}
                </TBody>
              </Table>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button loading={save.isPending} disabled={!picked.size} onClick={() => save.mutate(undefined)}>创建并分配（{picked.size} 卷）</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
