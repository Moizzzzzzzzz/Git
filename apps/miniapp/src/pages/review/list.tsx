import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope, type JudgeResult } from '@fabricqc/shared';
import { useState } from 'react';
import { JudgeTag } from '@/components/EvaluationView';
import { api, errorText } from '@/lib/api';

interface Item {
  id: string;
  revision: number;
  mode: InspectionMode;
  scope: InspectionScope;
  roll: { rollNo: string; fabric: { code: string; nameZh: string } };
  inspector: { name: string };
  overallResult: JudgeResult | null;
  normalizedPoints: number | null;
  defectCount: number;
  submittedAt: string;
}

export default function ReviewList() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await api.get<Item[]>('/reviews/pending'));
      const s = await api.get<{ templates: { reviewRequest: string | null } }>('/notifications/wechat-subscriptions');
      setTemplateId(s.templates.reviewRequest);
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      Taro.stopPullDownRefresh();
    }
  }
  useDidShow(() => void load());
  usePullDownRefresh(() => void load());

  /** 一次性订阅：每次"允许"可接收一条提醒，需要用户主动点击 */
  function subscribe() {
    if (!templateId) return;
    Taro.requestSubscribeMessage({ tmplIds: [templateId], entityIds: [] } as unknown as Taro.requestSubscribeMessage.Option)
      .then((r) => {
        const accepted = (r as unknown as Record<string, string>)[templateId] === 'accept';
        return api.post<{ subscriptions: { remaining: number }[] }>('/notifications/wechat-subscriptions', { results: [{ templateId, accepted }] })
          .then((x) => {
            void Taro.showToast({ title: accepted ? `可接收 ${x.subscriptions[0]?.remaining ?? 0} 条提醒` : '未授权提醒', icon: 'none' });
          });
      })
      .catch(() => void Taro.showToast({ title: '授权失败', icon: 'none' }));
  }

  return (
    <View className="container">
      {templateId && (
        <View className="card row">
          <View className="muted" style={{ flex: 1 }}>开启微信提醒：有新的待审核记录时通知你（每次授权可接收一条）</View>
          <Button className="btn small secondary" onClick={subscribe}>接收提醒</Button>
        </View>
      )}
      {error && <View className="error-box">{error}</View>}
      {items && !items.length && <View className="empty">暂无待审核记录</View>}
      {items?.map((r) => (
        <View key={r.id} className="card" onClick={() => Taro.navigateTo({ url: `/pages/review/detail?id=${r.id}` })}>
          <View className="row">
            <Text style={{ fontSize: '34px', fontWeight: 600 }}>{r.roll.rollNo}</Text>
            <JudgeTag value={r.overallResult} />
          </View>
          <View className="muted" style={{ marginTop: '8px' }}>
            {r.roll.fabric.code} · {r.inspector.name} · {MODE_LABELS[r.mode]} · {SCOPE_LABELS[r.scope]}
          </View>
          <View className="muted">
            疵点 {r.defectCount} · 标准化 {r.normalizedPoints ?? '-'} · {r.revision > 1 ? `第 ${r.revision} 次提交 · ` : ''}{r.submittedAt.slice(5, 16).replace('T', ' ')}
          </View>
        </View>
      ))}
    </View>
  );
}
