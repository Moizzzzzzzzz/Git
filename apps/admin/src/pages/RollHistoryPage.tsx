import { DECISION_LABELS, MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope, type InspectionStatus, type JudgeResult, type ReviewDecision } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { InspectionStatusBadge, JudgeBadge, KV, PageHeader, QueryState, RollStatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/utils';
import type { RollRow } from './RollsPage';

export interface RollHistory {
  roll: RollRow & { fabric: RollRow['fabric'] & { widthCm: number | null; gsm: number | null } };
  inspections: {
    id: string;
    inspectionNo: string;
    status: InspectionStatus;
    mode: InspectionMode;
    scope: InspectionScope;
    revision: number;
    previousInspectionId: string | null;
    inspector: { name: string; employeeNo: string };
    task: { taskNo: string; title: string };
    overallResult: JudgeResult | null;
    fourPointResult: JudgeResult | null;
    customerResult: JudgeResult | null;
    totalPoints: number | null;
    normalizedPoints: number | null;
    inspectedLengthM: number | null;
    startedAt: string;
    submittedAt: string | null;
    decidedAt: string | null;
    defectCount: number;
    photoCount: number;
    revisions: { revision: number; submittedAt: string }[];
    reviews: { id: string; revision: number; decision: ReviewDecision; comment: string | null; isConcession: boolean; createdAt: string; reviewer: { name: string } }[];
  }[];
}

export function RollHistoryView({ data }: { data: RollHistory }) {
  const r = data.roll;
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 md:grid-cols-6">
          <KV label="卷号"><span className="font-semibold">{r.rollNo}</span></KV>
          <KV label="面料">{r.fabric.code} {r.fabric.nameZh}</KV>
          <KV label="批号 / 缸号">{r.lot?.lotNo ?? '-'} / {r.dyeLotNo ?? '-'}</KV>
          <KV label="标称 / 实际长度">{fmtNum(r.nominalLengthM)} / {fmtNum(r.actualLengthM)} m</KV>
          <KV label="状态"><RollStatusBadge value={r.status} /></KV>
          <KV label="二维码标识"><span className="font-mono">{r.qrCode}</span></KV>
        </CardContent>
      </Card>
      {!data.inspections.length && <p className="text-sm text-muted-foreground">该布卷还没有检验记录。</p>}
      {data.inspections.map((i, idx) => (
        <Card key={i.id}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              第 {idx + 1} 次检验 · {i.inspectionNo}
              {i.previousInspectionId && <Badge variant="warning">复验</Badge>}
            </CardTitle>
            <div className="flex items-center gap-2">
              <InspectionStatusBadge value={i.status} />
              <Button asChild size="sm" variant="outline"><Link to={`/inspections/${i.id}`}>查看详情</Link></Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
              <KV label="质检员">{i.inspector.name}</KV>
              <KV label="方式 / 范围">{MODE_LABELS[i.mode]} · {SCOPE_LABELS[i.scope]}</KV>
              <KV label="受检长度">{fmtNum(i.inspectedLengthM)} m</KV>
              <KV label="四分制 / 客户 / 综合">
                <span className="flex gap-1"><JudgeBadge value={i.fourPointResult} /><JudgeBadge value={i.customerResult} /><JudgeBadge value={i.overallResult} /></span>
              </KV>
              <KV label="总分 / 标准化">{fmtNum(i.totalPoints)} / {fmtNum(i.normalizedPoints)}</KV>
              <KV label="疵点 / 照片">{i.defectCount} / {i.photoCount}</KV>
            </div>
            <div className="mt-4 space-y-1.5 border-t pt-3 text-sm">
              <div className="text-muted-foreground">开始 {fmtDate(i.startedAt)}</div>
              {i.revisions.map((rv) => (
                <div key={rv.revision}>
                  <span className="text-muted-foreground">{fmtDate(rv.submittedAt)}</span> 提交修订 {rv.revision}
                  {i.reviews.filter((x) => x.revision === rv.revision).map((x) => (
                    <span key={x.id} className="ml-2">
                      → {x.reviewer.name}：<b>{DECISION_LABELS[x.decision]}</b>
                      {x.isConcession && <Badge variant="warning" className="ml-1">让步接收</Badge>}
                      {x.comment && <span className="text-muted-foreground">（{x.comment}）</span>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RollHistoryPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['roll-history', id], queryFn: () => api.get<RollHistory>(`/rolls/${id}/history`) });
  return (
    <>
      <PageHeader
        title="布卷质检历史"
        actions={<Button variant="outline" asChild><Link to="/rolls"><ArrowLeft /> 返回布卷</Link></Button>}
      />
      <QueryState q={q}>{q.data && <RollHistoryView data={q.data} />}</QueryState>
    </>
  );
}
