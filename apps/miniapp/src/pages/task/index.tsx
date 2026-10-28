import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { INSPECTION_STATUS_LABELS, JUDGE_LABELS, MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope, type InspectionStatus, type JudgeResult } from '@fabricqc/shared';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { openTaskRoll, scanRoll } from '@/lib/scan';

interface TaskDetail {
  id: string;
  taskNo: string;
  title: string;
  notes: string | null;
  defaultMode: InspectionMode | null;
  defaultScope: InspectionScope;
  template: { name: string };
  fourPointStandard: { name: string };
  customerStandard: { name: string } | null;
  rolls: {
    taskRollId: string;
    status: string;
    roll: { rollNo: string; nominalLengthM: number | null; dyeLotNo: string | null; fabric: { code: string; nameZh: string } };
    latestInspection: { id: string; status: InspectionStatus; overallResult: JudgeResult | null } | null;
  }[];
}

const statusTone: Record<string, string> = { DRAFT: '', SUBMITTED: 'warn', RETURNED: 'danger', APPROVED: 'success', REJECTED: 'danger', VOIDED: 'gray' };

export default function Task() {
  const { params } = useRouter();
  const [t, setT] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setT(await api.get<TaskDetail>(`/tasks/${params.id}`));
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      Taro.stopPullDownRefresh();
    }
  }
  useDidShow(() => void load());
  usePullDownRefresh(() => void load());

  if (!t) return <View className="container">{error ? <View className="error-box">{error}</View> : <View className="empty">加载中…</View>}</View>;
  return (
    <View className="container">
      <View className="card">
        <View className="card-title">{t.title}</View>
        <View className="kv"><Text className="k">任务号</Text><Text>{t.taskNo}</Text></View>
        <View className="kv"><Text className="k">建议方式</Text><Text>{t.defaultMode ? MODE_LABELS[t.defaultMode] : '现场选择'} · {SCOPE_LABELS[t.defaultScope]}</Text></View>
        <View className="kv"><Text className="k">四分制标准</Text><Text>{t.fourPointStandard.name}</Text></View>
        {t.customerStandard && <View className="kv"><Text className="k">客户标准</Text><Text>{t.customerStandard.name}</Text></View>}
        {t.notes && <View className="muted">备注：{t.notes}</View>}
      </View>
      {t.rolls.map((r) => (
        <View
          key={r.taskRollId}
          className="card"
          onClick={() =>
            void openTaskRoll(r.roll.rollNo, [
              {
                taskRollId: r.taskRollId,
                status: r.status,
                task: { id: t.id, taskNo: t.taskNo, title: t.title, defaultMode: t.defaultMode, defaultScope: t.defaultScope },
                inspection: r.latestInspection,
              },
            ])
          }
        >
          <View className="row">
            <Text style={{ fontSize: '34px', fontWeight: 600 }}>{r.roll.rollNo}</Text>
            {r.latestInspection ? (
              <Text className={`tag ${statusTone[r.latestInspection.status]}`}>{INSPECTION_STATUS_LABELS[r.latestInspection.status]}</Text>
            ) : (
              <Text className="tag gray">未开始</Text>
            )}
          </View>
          <View className="muted" style={{ marginTop: '8px' }}>
            {r.roll.fabric.code} · 缸号 {r.roll.dyeLotNo ?? '-'} · 标称 {r.roll.nominalLengthM ?? '-'} m
            {r.latestInspection?.overallResult ? ` · 判定 ${JUDGE_LABELS[r.latestInspection.overallResult]}` : ''}
          </View>
        </View>
      ))}
      <View className="bottom-bar">
        <Button className="btn" onClick={() => void scanRoll()}>扫码验布</Button>
      </View>
    </View>
  );
}
