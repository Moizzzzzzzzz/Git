import { MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope, type JudgeResult } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { JudgeBadge, PageHeader, QueryState } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/utils';

interface QueueItem {
  id: string;
  inspectionNo: string;
  revision: number;
  mode: InspectionMode;
  scope: InspectionScope;
  roll: { rollNo: string; fabric: { code: string; nameZh: string } };
  inspector: { name: string };
  task: { taskNo: string };
  overallResult: JudgeResult | null;
  fourPointResult: JudgeResult | null;
  customerResult: JudgeResult | null;
  normalizedPoints: number | null;
  defectCount: number;
  submittedAt: string;
}

export function ReviewsPage() {
  const q = useQuery({ queryKey: ['reviews', 'queue'], queryFn: () => api.get<QueueItem[]>('/reviews/queue'), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="审核中心" description="授权范围内的待审核检验记录（按提交时间排序）" />
      <Card>
        <QueryState q={q} empty={q.data?.length === 0}>
          <Table>
            <THead>
              <TR><TH>卷号</TH><TH>面料</TH><TH>质检员</TH><TH>方式 / 范围</TH><TH>疵点</TH><TH>标准化得分</TH><TH>四分制</TH><TH>客户</TH><TH>综合</TH><TH>提交时间</TH><TH /></TR>
            </THead>
            <TBody>
              {q.data?.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">
                    {r.roll.rollNo}
                    {r.revision > 1 && <Badge variant="warning" className="ml-1.5">第 {r.revision} 次</Badge>}
                  </TD>
                  <TD>{r.roll.fabric.code}</TD>
                  <TD>{r.inspector.name}</TD>
                  <TD className="whitespace-nowrap">{MODE_LABELS[r.mode]} · {SCOPE_LABELS[r.scope]}</TD>
                  <TD>{r.defectCount}</TD>
                  <TD className="tabular-nums">{fmtNum(r.normalizedPoints)}</TD>
                  <TD><JudgeBadge value={r.fourPointResult} /></TD>
                  <TD><JudgeBadge value={r.customerResult} /></TD>
                  <TD><JudgeBadge value={r.overallResult} /></TD>
                  <TD className="text-muted-foreground">{fmtDate(r.submittedAt)}</TD>
                  <TD className="text-right"><Button asChild size="sm"><Link to={`/inspections/${r.id}`}>审核</Link></Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </QueryState>
      </Card>
    </>
  );
}
