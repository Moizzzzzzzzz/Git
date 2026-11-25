import {Text,View} from '@tarojs/components';
import {JUDGE_LABELS} from '@fabricqc/shared';
import {scoreUnitLabel} from '@/lib/score-unit';
import {finalQualityLabel,type QualityReviewFields} from '@/lib/quality-review';
import {formatBeijingTime} from '@/lib/report-format';
export default function QualityReviewSummary({value:i}:{value:QualityReviewFields}) {
 if(i.systemResult===undefined&&!i.reviewEligibility&&i.finalResult===undefined)return null;
 return <View className="card"><View className="card-title">质量结论与主管复核</View>
  <View>系统原判定：{i.systemResult?JUDGE_LABELS[i.systemResult]:'未记录'}</View>
  <View>原始标准化分：{i.normalizedScore??'—'} {scoreUnitLabel(i.scoreUnit)}</View>
  {i.systemReasons?.map((r,n)=><View className="muted" key={`sys-${n}`}>{r}</View>)}
  {i.reviewEligibility?.reasons.map((r,n)=><View key={`${r.code}-${n}`}>{r.message}</View>)}
  {i.finalResult?<><View>{finalQualityLabel(i.finalResult)}</View><View>复核原因：{i.finalReason||'未记录'}</View><View className="muted">{i.reviewer?.name??'审核人未记录'} · {i.reviewedAt?formatBeijingTime(i.reviewedAt):'审核时间未记录'}</View></>:i.reviewEligibility?.required?<Text className="tag warn">待主管复核</Text>:null}
 </View>;
}
