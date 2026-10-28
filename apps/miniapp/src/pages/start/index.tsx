import { Button, View } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { INSPECTION_MODES, INSPECTION_SCOPES, MODE_LABELS, SCOPE_LABELS, type InspectionMode, type InspectionScope } from '@fabricqc/shared';
import { useState } from 'react';
import { api, toastError } from '@/lib/api';

const SCOPE_HINT: Record<InspectionScope, string> = {
  FULL: '检验整卷全部长度，系统会校验区段覆盖整卷',
  PARTIAL: '只检验部分长度，结论注明"仅基于部分检验"',
  SAMPLING: '按抽检方案检验若干区段',
};

export default function Start() {
  const { params } = useRouter();
  const [mode, setMode] = useState<InspectionMode | ''>((params.mode as InspectionMode) || '');
  const [scope, setScope] = useState<InspectionScope>((params.scope as InspectionScope) || 'FULL');
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!mode) {
      void Taro.showToast({ title: '请选择检验方式', icon: 'none' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/inspections', { taskRollId: params.taskRollId, mode, scope });
      await Taro.redirectTo({ url: `/pages/inspect/index?id=${r.id}` });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="container">
      <View className="card">
        <View className="muted">布卷</View>
        <View style={{ fontSize: '44px', fontWeight: 700, marginTop: '6px' }}>{decodeURIComponent(params.rollNo ?? '')}</View>
      </View>
      <View className="card">
        <View className="card-title">检验方式</View>
        <View className="seg">
          {INSPECTION_MODES.map((m) => (
            <View key={m} className={`seg-item ${mode === m ? 'active' : ''}`} style={{ height: '120px', fontSize: '34px' }} onClick={() => setMode(m)}>
              {MODE_LABELS[m]}
            </View>
          ))}
        </View>
      </View>
      <View className="card">
        <View className="card-title">检验范围</View>
        <View className="seg">
          {INSPECTION_SCOPES.map((s) => (
            <View key={s} className={`seg-item ${scope === s ? 'active' : ''}`} onClick={() => setScope(s)}>
              {SCOPE_LABELS[s]}
            </View>
          ))}
        </View>
        <View className="muted" style={{ marginTop: '16px' }}>{SCOPE_HINT[scope]}</View>
      </View>
      <View className="bottom-bar">
        <Button className="btn" loading={busy} disabled={busy} onClick={() => void start()}>开始检验</Button>
      </View>
    </View>
  );
}
