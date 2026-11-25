import {JUDGE_LABELS} from '@fabricqc/shared';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {scoreUnitLabel} from '@/lib/score-unit';
import {fmtDate} from '@/lib/utils';
import {finalQualityLabel,type QualityReviewFields} from '@/lib/quality-review';
export function QualityReviewSummary({value:i}:{value:QualityReviewFields}) {
 if(i.systemResult===undefined&&!i.reviewEligibility&&i.finalResult===undefined)return null;
 return <Card><CardHeader><CardTitle>质量结论与主管复核</CardTitle></CardHeader><CardContent className="space-y-2">
  <p>系统原判定：{i.systemResult?JUDGE_LABELS[i.systemResult]:'未记录'}</p><p>原始标准化分：{i.normalizedScore??'—'} {scoreUnitLabel(i.scoreUnit)}</p>
  {i.systemReasons?.map((r,n)=><p className="text-sm text-muted-foreground" key={`sys-${n}`}>{r}</p>)}
  {i.reviewEligibility?.reasons.map((r,n)=><p key={`${r.code}-${n}`}>{r.message}</p>)}
  {i.finalResult?<><p className="font-medium">{finalQualityLabel(i.finalResult)}</p><p>复核原因：{i.finalReason||'未记录'}</p><p className="text-sm text-muted-foreground">{i.reviewer?.name??'审核人未记录'} · {i.reviewedAt?fmtDate(i.reviewedAt):'审核时间未记录'}</p></>:i.reviewEligibility?.required?<p className="text-amber-700">待主管复核</p>:null}
 </CardContent></Card>;
}
