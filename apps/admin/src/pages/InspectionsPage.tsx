import { INSPECTION_STATUSES, INSPECTION_STATUS_LABELS, JUDGE_LABELS, MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope, type InspectionStatus, type JudgeResult } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, InspectionStatusBadge, JudgeBadge, PageHeader, Pager, QueryState, SearchBox } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, qs, type Paged } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/utils';
import { RollHistoryView, type RollHistory } from './RollHistoryPage';

interface Row {
  id: string;
  inspectionNo: string;
  status: InspectionStatus;
  mode: InspectionMode;
  scope: InspectionScope;
  revision: number;
  overallResult: JudgeResult | null;
  normalizedPoints: number | null;
  inspectedLengthM: number | null;
  startedAt: string;
  submittedAt: string | null;
  roll: { id: string; rollNo: string; fabric: { code: string; nameZh: string } };
  inspector: { name: string };
  task: { taskNo: string };
  _count: { defects: number };
}

export function InspectionsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [lookup, setLookup] = useState('');
  const list = useQuery({
    queryKey: ['inspections', page, q, status, result, from, to],
    queryFn: () =>
      api.get<Paged<Row>>(
        `/inspections${qs({
          page,
          pageSize: 20,
          q,
          status,
          overallResult: result,
          from: from ? new Date(`${from}T00:00:00+08:00`).toISOString() : '',
          to: to ? new Date(`${to}T23:59:59+08:00`).toISOString() : '',
        })}`,
      ),
  });
  const history = useQuery({
    queryKey: ['roll-history-by-no', lookup],
    queryFn: () => api.get<RollHistory>(`/rolls/by-no/${encodeURIComponent(lookup)}/history`),
    enabled: !!lookup,
    retry: false,
  });

  return (
    <>
      <PageHeader title="质检记录" description="按卷号查询完整质检历史，或按条件筛选检验记录" />
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <span className="text-sm font-medium">按卷号查历史</span>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setLookup(rollNo.trim());
            }}
          >
            <Input className="w-64" placeholder="输入完整卷号" value={rollNo} onChange={(e) => setRollNo(e.target.value)} />
            <Button type="submit"><Search /> 查询</Button>
            {lookup && <Button type="button" variant="ghost" onClick={() => { setLookup(''); setRollNo(''); }}>清除</Button>}
          </form>
        </CardContent>
      </Card>
      {lookup && (
        <div className="mb-6">
          {history.isLoading ? null : history.error ? <ErrorBox error={history.error} /> : history.data && <RollHistoryView data={history.data} />}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="检验号 / 卷号 / 货号" />
          <NativeSelect className="w-32" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">全部状态</option>
            {INSPECTION_STATUSES.map((s) => <option key={s} value={s}>{INSPECTION_STATUS_LABELS[s]}</option>)}
          </NativeSelect>
          <NativeSelect className="w-32" value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }}>
            <option value="">全部判定</option>
            {(['PASS', 'FAIL', 'INCONCLUSIVE'] as const).map((s) => <option key={s} value={s}>{JUDGE_LABELS[s]}</option>)}
          </NativeSelect>
          <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <span className="text-muted-foreground">至</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        <QueryState q={list}>
          <Table>
            <THead>
              <TR><TH>检验号</TH><TH>卷号</TH><TH>面料</TH><TH>质检员</TH><TH>方式 / 范围</TH><TH>受检长度</TH><TH>疵点</TH><TH>标准化得分</TH><TH>系统判定</TH><TH>状态</TH><TH>开始时间</TH></TR>
            </THead>
            <TBody>
              {list.data?.items.map((r) => (
                <TR key={r.id}>
                  <TD><Link className="font-medium text-primary hover:underline" to={`/inspections/${r.id}`}>{r.inspectionNo}</Link></TD>
                  <TD><Link className="hover:underline" to={`/rolls/${r.roll.id}/history`}>{r.roll.rollNo}</Link></TD>
                  <TD>{r.roll.fabric.code}</TD>
                  <TD>{r.inspector.name}</TD>
                  <TD className="whitespace-nowrap">{MODE_LABELS[r.mode]} · {SCOPE_LABELS[r.scope]}</TD>
                  <TD className="tabular-nums">{fmtNum(r.inspectedLengthM)} m</TD>
                  <TD>{r._count.defects}</TD>
                  <TD className="tabular-nums">{fmtNum(r.normalizedPoints)}</TD>
                  <TD><JudgeBadge value={r.overallResult} /></TD>
                  <TD><InspectionStatusBadge value={r.status} /></TD>
                  <TD className="text-muted-foreground">{fmtDate(r.startedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
        </QueryState>
      </Card>
    </>
  );
}
