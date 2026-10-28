import {
  DECISION_LABELS,
  JUDGE_LABELS,
  MODE_LABELS,
  SCOPE_LABELS,
  SEVERITY_LABELS,
  type DefectSeverity,
  type InspectionMode,
  type InspectionScope,
  type InspectionStatus,
  type JudgeResult,
  type ReviewDecision,
  type TemplateContent,
} from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleX } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DevDefaultBadge, InspectionStatusBadge, JudgeBadge, KV, PageHeader, QueryState } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { cn, fmtDate, fmtNum } from '@/lib/utils';
import { useDefectTypes } from './StandardsPage';

interface Check {
  code: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  actual: string | number | null;
  limit: string | number | null;
  message: string;
}
interface StdEval {
  name: string;
  result: JudgeResult;
  checks: Check[];
  scoring: { totalPoints: number; rawPoints: number; capReduction: number; normalizedPoints: number | null; areaUnit: string; defectScores: { clientId: string; points: number; rule: string }[] };
}
interface Evaluation {
  engineVersion: string;
  inspectedLengthM: number;
  widthUsedCm: number | null;
  widthBasis: string;
  inspectedAreaM2: number | null;
  fourPoint: StdEval;
  customer: StdEval | null;
  overall: { result: JudgeResult; reasons: string[] };
  warnings: string[];
}
interface Photo {
  mediaId: string;
  kind: 'CHECKPOINT' | 'DEFECT' | 'GENERAL';
  checkpointKey: string | null;
  defectClientId: string | null;
  url: string;
  thumbUrl: string | null;
}
export interface InspectionDetail {
  id: string;
  inspectionNo: string;
  status: InspectionStatus;
  mode: InspectionMode;
  scope: InspectionScope;
  revision: number;
  previousInspectionId: string | null;
  roll: { id: string; rollNo: string; dyeLotNo: string | null; colorCode: string | null; nominalLengthM: number | null; lot: { lotNo: string } | null; fabric: { code: string; nameZh: string } };
  task: { id: string; taskNo: string; title: string };
  inspector: { name: string; employeeNo: string };
  spec: Record<string, string | number | null>;
  template: TemplateContent;
  standards: { fourPoint: { name: string; version: number; isDevDefault: boolean }; customer: { name: string; version: number; isDevDefault: boolean } | null };
  segments: { startM: number; endM: number }[];
  measurements: { itemKey: string; seq: number; value: number; unit: string }[];
  checklist: { key: string; status: 'OK' | 'NG' | 'NA'; note?: string | null }[];
  defects: { clientId: string; defectTypeCode: string; lengthCm: number; widthCm: number | null; positionM: number; widthPositionCm: number | null; severity: DefectSeverity; points: number | null; remark: string | null }[];
  photos: Photo[];
  remarks: string | null;
  result: Evaluation | null;
  overallResult: JudgeResult | null;
  inspectedLengthM: number | null;
  actualLengthM: number | null;
  startedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  reviews: { id: string; revision: number; decision: ReviewDecision; comment: string | null; isConcession: boolean; createdAt: string; reviewer: { name: string } }[];
  assignments: { revision: number; status: string; assignee: { name: string } }[];
  revisions: { revision: number; submittedAt: string }[];
  permissions: { canEdit: boolean; canReview: boolean };
}

const WIDTH_BASIS: Record<string, string> = {
  MEASURED_EFFECTIVE: '实测有效门幅',
  SPEC_CUTTABLE: '规格可裁门幅',
  SPEC_WIDTH: '规格门幅',
  NONE: '无',
};
const AREA_UNIT: Record<string, string> = { PER_100_SQ_YD: '分/100平方码', PER_100_SQ_M: '分/100平方米' };

function CheckIcon({ s }: { s: Check['status'] }) {
  if (s === 'PASS') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (s === 'FAIL') return <CircleX className="h-4 w-4 text-red-600" />;
  return <CircleAlert className="h-4 w-4 text-amber-600" />;
}

function StdCard({ title, e, devDefault }: { title: string; e: StdEval; devDefault?: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">{title}{devDefault && <DevDefaultBadge />}</CardTitle>
        <JudgeBadge value={e.result} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{e.name}</div>
        <div className="grid grid-cols-3 gap-3">
          <KV label="累计扣分">{fmtNum(e.scoring.rawPoints)}</KV>
          <KV label="封顶后">{fmtNum(e.scoring.totalPoints)}</KV>
          <KV label="标准化">{fmtNum(e.scoring.normalizedPoints)} <span className="text-xs text-muted-foreground">{AREA_UNIT[e.scoring.areaUnit]}</span></KV>
        </div>
        <div className="space-y-1.5">
          {e.checks.map((c) => (
            <div key={c.code} className="flex items-start gap-2 text-sm">
              <CheckIcon s={c.status} />
              <span className={cn(c.status !== 'PASS' && 'font-medium')}>{c.message}</span>
            </div>
          ))}
          {!e.checks.length && <p className="text-sm text-muted-foreground">无判定规则</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoThumb({ p, onOpen }: { p: Photo; onOpen: (p: Photo) => void }) {
  return (
    <button onClick={() => onOpen(p)} className="h-20 w-20 overflow-hidden rounded border bg-muted">
      {p.thumbUrl || p.url ? <img src={p.thumbUrl ?? p.url} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="text-xs">无法加载</span>}
    </button>
  );
}

export function InspectionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['inspection', id], queryFn: () => api.get<InspectionDetail>(`/inspections/${id}`) });
  const types = useDefectTypes();
  const [preview, setPreview] = useState<Photo | null>(null);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [reopen, setReopen] = useState(false);
  const i = q.data;
  const typeName = (code: string) => types.data?.find((t) => t.code === code)?.nameZh ?? code;
  const tplLabel = (key: string, list: { key: string; label: string }[] | undefined) => list?.find((x) => x.key === key)?.label ?? key;
  const ev = i?.result;

  return (
    <>
      <PageHeader
        title={i ? `检验 ${i.inspectionNo}` : '检验详情'}
        description={i ? `卷 ${i.roll.rollNo} · ${i.roll.fabric.code} ${i.roll.fabric.nameZh}` : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => history.back()}><ArrowLeft /> 返回</Button>
            {i && <Button variant="outline" asChild><Link to={`/rolls/${i.roll.id}/history`}>布卷历史</Link></Button>}
            {i?.permissions.canReview && (
              <>
                <Button variant="outline" onClick={() => setDecision('RETURN')}>退回修改</Button>
                <Button variant="destructive" onClick={() => setDecision('REJECT')}>判定不合格</Button>
                <Button onClick={() => setDecision('APPROVE')}>审核通过</Button>
              </>
            )}
            {i && (i.status === 'APPROVED' || i.status === 'REJECTED') && can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR') && (
              <Button variant="outline" onClick={() => setReopen(true)}>发起复验</Button>
            )}
          </>
        }
      />
      <QueryState q={q}>
        {i && (
          <div className="space-y-5">
            <Card>
              <CardContent className="grid grid-cols-2 gap-4 p-5 md:grid-cols-6">
                <KV label="状态"><InspectionStatusBadge value={i.status} /></KV>
                <KV label="综合判定"><JudgeBadge value={i.overallResult} /></KV>
                <KV label="检验方式">{MODE_LABELS[i.mode]}</KV>
                <KV label="检验范围"><Badge variant={i.scope === 'FULL' ? 'secondary' : 'warning'}>{SCOPE_LABELS[i.scope]}</Badge></KV>
                <KV label="受检 / 实测卷长">{fmtNum(i.inspectedLengthM)} / {fmtNum(i.actualLengthM)} m</KV>
                <KV label="修订">第 {i.revision} 次提交</KV>
                <KV label="质检员">{i.inspector.name}</KV>
                <KV label="任务"><Link className="text-primary hover:underline" to={`/tasks/${i.task.id}`}>{i.task.taskNo}</Link></KV>
                <KV label="批号 / 缸号">{i.roll.lot?.lotNo ?? '-'} / {i.roll.dyeLotNo ?? '-'}</KV>
                <KV label="规格门幅 / 可裁">{fmtNum(i.spec.widthCm as number)} / {fmtNum(i.spec.cuttableWidthCm as number)} cm</KV>
                <KV label="规格克重">{fmtNum(i.spec.gsm as number)} g/m²</KV>
                <KV label="提交时间">{fmtDate(i.submittedAt)}</KV>
              </CardContent>
            </Card>

            {ev && (
              <>
                {(ev.warnings.length > 0 || ev.overall.reasons.length > 0) && (
                  <Card className={cn(ev.overall.result === 'FAIL' ? 'border-red-200' : 'border-amber-200')}>
                    <CardContent className="space-y-1 p-4 text-sm">
                      {ev.overall.reasons.map((r) => <div key={r} className="text-red-700">● {r}</div>)}
                      {ev.warnings.map((w) => <div key={w} className="text-amber-700">⚠ {w}</div>)}
                    </CardContent>
                  </Card>
                )}
                <div className="grid gap-5 lg:grid-cols-2">
                  <StdCard title="四分制" e={ev.fourPoint} devDefault={i.standards.fourPoint.isDevDefault} />
                  {ev.customer ? <StdCard title="客户标准" e={ev.customer} devDefault={i.standards.customer?.isDevDefault} /> : (
                    <Card><CardContent className="p-5 text-sm text-muted-foreground">本次检验未使用客户标准</CardContent></Card>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  面积按 {WIDTH_BASIS[ev.widthBasis]} {fmtNum(ev.widthUsedCm)} cm 计算，受检面积 {fmtNum(ev.inspectedAreaM2)} m²；评分引擎 v{ev.engineVersion}
                </p>
              </>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>实测参数</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {i.template.measurements.map((m) => {
                    const vals = i.measurements.filter((x) => x.itemKey === m.key);
                    return (
                      <div key={m.key} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{m.label}</span>
                        <span className="tabular-nums">{vals.length ? vals.map((v) => fmtNum(v.value, 3)).join(' / ') : '-'} {m.unit}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between gap-3 border-t pt-2">
                    <span className="text-muted-foreground">检验区段</span>
                    <span>{i.segments.map((s) => `${fmtNum(s.startM)}–${fmtNum(s.endM)} m`).join('，') || '-'}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>检查清单</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {i.template.checklist.map((c) => {
                    const r = i.checklist.find((x) => x.key === c.key);
                    return (
                      <div key={c.key} className="flex justify-between gap-3">
                        <span>{c.label}</span>
                        <span>
                          {r ? <Badge variant={r.status === 'OK' ? 'success' : r.status === 'NG' ? 'destructive' : 'secondary'}>{r.status === 'OK' ? '合格' : r.status === 'NG' ? '不合格' : '不适用'}</Badge> : '-'}
                          {r?.note && <span className="ml-2 text-muted-foreground">{r.note}</span>}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>疵点（{i.defects.length}）</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR><TH>米位</TH><TH>疵点</TH><TH>长 × 宽 (cm)</TH><TH>幅宽位置</TH><TH>严重度</TH><TH>扣分</TH><TH>备注</TH><TH>照片</TH></TR>
                  </THead>
                  <TBody>
                    {i.defects.map((d) => (
                      <TR key={d.clientId}>
                        <TD className="tabular-nums">{fmtNum(d.positionM)} m</TD>
                        <TD>{typeName(d.defectTypeCode)}</TD>
                        <TD className="tabular-nums">{fmtNum(d.lengthCm)} × {fmtNum(d.widthCm)}</TD>
                        <TD className="tabular-nums">{d.widthPositionCm !== null ? `${fmtNum(d.widthPositionCm)} cm` : '-'}</TD>
                        <TD><Badge variant={d.severity === 'CRITICAL' ? 'destructive' : d.severity === 'MAJOR' ? 'warning' : 'secondary'}>{SEVERITY_LABELS[d.severity]}</Badge></TD>
                        <TD className="tabular-nums">{fmtNum(d.points)}</TD>
                        <TD className="max-w-[200px] truncate text-muted-foreground">{d.remark ?? '-'}</TD>
                        <TD>
                          <div className="flex gap-1">
                            {i.photos.filter((p) => p.defectClientId === d.clientId).map((p) => <PhotoThumb key={p.mediaId} p={p} onOpen={setPreview} />)}
                          </div>
                        </TD>
                      </TR>
                    ))}
                    {!i.defects.length && <TR><TD colSpan={8} className="py-6 text-center text-muted-foreground">无疵点</TD></TR>}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>检查点照片</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {i.template.photoCheckpoints.map((c) => (
                  <div key={c.key}>
                    <div className="mb-1 text-sm">{tplLabel(c.key, i.template.photoCheckpoints)}</div>
                    <div className="flex flex-wrap gap-2">
                      {i.photos.filter((p) => p.kind === 'CHECKPOINT' && p.checkpointKey === c.key).map((p) => <PhotoThumb key={p.mediaId} p={p} onOpen={setPreview} />)}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>备注与审核记录</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">质检员备注：</span>{i.remarks || '无'}</div>
                <div className="border-t pt-2">
                  <div className="text-muted-foreground">开始检验 {fmtDate(i.startedAt)}</div>
                  {i.revisions.map((rv) => (
                    <div key={rv.revision} className="mt-1">
                      {fmtDate(rv.submittedAt)} · 第 {rv.revision} 次提交
                      {i.reviews.filter((r) => r.revision === rv.revision).map((r) => (
                        <span key={r.id} className="ml-2">
                          → {r.reviewer.name} {fmtDate(r.createdAt)}：<b>{DECISION_LABELS[r.decision]}</b>
                          {r.isConcession && <Badge variant="warning" className="ml-1">让步接收</Badge>}
                          {r.comment && <span className="text-muted-foreground">（{r.comment}）</span>}
                        </span>
                      ))}
                      {i.status === 'SUBMITTED' && rv.revision === i.revision && (
                        <span className="ml-2 text-muted-foreground">
                          待审核：{i.assignments.filter((a) => a.revision === rv.revision && a.status === 'PENDING').map((a) => a.assignee.name).join('、') || '-'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <DialogContent title="照片" wide>
            <img src={preview.url} alt="" className="mx-auto max-h-[70vh] rounded" />
            <div className="mt-2 text-center">
              <a className="text-sm text-primary hover:underline" href={preview.url} target="_blank" rel="noreferrer">查看原图</a>
            </div>
          </DialogContent>
        )}
      </Dialog>
      {decision && i && <DecisionDialog inspection={i} decision={decision} onClose={() => setDecision(null)} />}
      {reopen && i && <ReopenDialog id={i.id} onClose={() => setReopen(false)} />}
    </>
  );
}

function DecisionDialog({ inspection, decision, onClose }: { inspection: InspectionDetail; decision: ReviewDecision; onClose: () => void }) {
  const [comment, setComment] = useState('');
  const concession = decision === 'APPROVE' && inspection.overallResult !== 'PASS';
  const needComment = decision !== 'APPROVE' || concession;
  const save = useAction(
    () => api.post(`/reviews/${inspection.id}/decide`, { decision, revision: inspection.revision, comment: comment || null }),
    { success: `已${DECISION_LABELS[decision]}`, invalidate: [['inspection', inspection.id], ['reviews'], ['dashboard']], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={DECISION_LABELS[decision]} description={`卷 ${inspection.roll.rollNo} · 第 ${inspection.revision} 次提交 · 系统判定：${inspection.overallResult ? JUDGE_LABELS[inspection.overallResult] : '-'}`}>
        {concession && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            系统判定不是"合格"，审核通过将记录为<b>让步接收</b>，必须填写理由。
          </p>
        )}
        <Field label={decision === 'RETURN' ? '退回原因（质检员可见）' : '审核意见'} required={needComment}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            variant={decision === 'REJECT' ? 'destructive' : 'default'}
            disabled={needComment && comment.trim().length < 2}
            loading={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            确认{DECISION_LABELS[decision]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/inspections/${id}/reopen`, { reason }), {
    success: '已发起复验，质检员将收到通知',
    invalidate: [['inspection', id]],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="发起复验" description="原检验记录保持不变；质检员重新检验时会生成新记录并关联本记录。">
        <Field label="复验原因" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={reason.trim().length < 2} loading={save.isPending} onClick={() => save.mutate(undefined)}>发起复验</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
