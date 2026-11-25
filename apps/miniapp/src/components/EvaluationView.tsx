import { Text, View } from '@tarojs/components';
import { JUDGE_LABELS, type JudgeResult } from '@fabricqc/shared';
import type { InspectionEvaluation, StandardEvaluation } from '@fabricqc/quality-engine';

const tone: Record<JudgeResult, string> = { PASS: 'success', FAIL: 'danger', INCONCLUSIVE: 'warn', NOT_APPLICABLE: 'gray' };
const AREA: Record<string, string> = { PER_100_SQ_YD: '分/100平方码', PER_100_SQ_M: '分/100平方米' };

export function JudgeTag({ value }: { value: JudgeResult | null | undefined }) {
  if (!value) return <Text className="tag gray">-</Text>;
  return <Text className={`tag ${tone[value]}`}>{JUDGE_LABELS[value]}</Text>;
}

function Std({ title, e, isDevDefault }: { title: string; e: StandardEvaluation; isDevDefault?:boolean }) {
  return (
    <View className="card">
      <View className="row">
        <Text className="card-title" style={{ marginBottom: 0 }}>{title}</Text>
        <JudgeTag value={e.result} />
      </View>
      <View className="muted" style={{ margin: '8px 0 12px' }}>{e.name}</View>
      {isDevDefault&&<View className="warn-box">开发测试标准，未经批准，不用于正式验收。</View>}
      <View className="kv"><Text className="k">累计扣分 / 封顶后</Text><Text>{e.scoring.rawPoints} / {e.scoring.totalPoints}</Text></View>
      <View className="kv"><Text className="k">标准化得分</Text><Text>{e.scoring.normalizedPoints ?? '-'} {AREA[e.scoring.areaUnit]}</Text></View>
      <View className="divider" />
      {e.checks.map((c) => (
        <View key={c.code} style={{ fontSize: '26px', padding: '6px 0', color: c.status === 'PASS' ? '#15803d' : c.status === 'FAIL' ? '#b91c1c' : '#92400e' }}>
          {c.status === 'PASS' ? '✓' : c.status === 'FAIL' ? '✗' : '!'} {c.message}
        </View>
      ))}
      {!e.checks.length && <View className="muted">无判定规则</View>}
    </View>
  );
}

export function EvaluationView({ e, label, standards }: { e: InspectionEvaluation; label?: string; standards?:{fourPoint?:{isDevDefault?:boolean};customer?:{isDevDefault?:boolean}|null} }) {
  return (
    <View>
      <View className="card">
        <View className="row">
          <Text className="card-title" style={{ marginBottom: 0 }}>综合结论</Text>
          <View className="row-gap">
            {label && <Text className="tag gray">{label}</Text>}
            <JudgeTag value={e.overall.result} />
          </View>
        </View>
        <View className="kv"><Text className="k">受检长度</Text><Text>{e.inspectedLengthM} m</Text></View>
        <View className="kv"><Text className="k">面积宽度</Text><Text>{e.widthUsedCm ?? '-'} cm</Text></View>
        <View className="kv"><Text className="k">疵点数</Text><Text>{e.defectCount}</Text></View>
        {e.overall.reasons.map((reason,n)=><View className="muted" key={`reason-${n}`}>{reason}</View>)}
        {e.warnings.map((w) => <View key={w} className="warn-box" style={{ marginTop: '12px', marginBottom: 0 }}>{w}</View>)}
      </View>
      <Std title="四分制" e={e.fourPoint} isDevDefault={standards?.fourPoint?.isDevDefault} />
      {e.customer && <Std title="客户标准" e={e.customer} isDevDefault={standards?.customer?.isDevDefault} />}
    </View>
  );
}
