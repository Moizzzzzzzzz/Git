import { Button, Image, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { DECISION_LABELS, JUDGE_LABELS, MODE_LABELS, SCOPE_LABELS, SEVERITY_LABELS, type ReviewDecision } from '@fabricqc/shared';
import { useState } from 'react';
import { EvaluationView } from '@/components/EvaluationView';
import { api, errorText, toastError } from '@/lib/api';
import type { DefectTypeOption, InspectionDetail, ServerPhoto } from '@/lib/types';

export default function ReviewDetail() {
  const { params } = useRouter();
  const [i, setI] = useState<InspectionDetail | null>(null);
  const [types, setTypes] = useState<DefectTypeOption[]>([]);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [detail, t] = await Promise.all([
        api.get<InspectionDetail>(`/inspections/${params.id}`),
        api.get<DefectTypeOption[]>('/defect-types'),
      ]);
      setI(detail);
      setTypes(t);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }
  useDidShow(() => void load());

  const preview = (list: ServerPhoto[], p: ServerPhoto) =>
    void Taro.previewImage({ urls: list.map((x) => x.url), current: p.url });

  async function decide(decision: ReviewDecision) {
    if (!i) return;
    const concession = decision === 'APPROVE' && i.overallResult !== 'PASS';
    if ((decision !== 'APPROVE' || concession) && comment.trim().length < 2) {
      void Taro.showModal({
        title: '请填写意见',
        content: concession ? '系统判定不是"合格"，审核通过将记为让步接收，必须填写理由。' : '退回或判定不合格必须填写原因。',
        showCancel: false,
      });
      return;
    }
    const ok = await Taro.showModal({ title: `确认${DECISION_LABELS[decision]}？`, content: `卷 ${i.roll.rollNo}` });
    if (!ok.confirm) return;
    setBusy(true);
    try {
      await api.post(`/reviews/${i.id}/decide`, { decision, revision: i.revision, comment: comment.trim() || null });
      void Taro.showToast({ title: `已${DECISION_LABELS[decision]}`, icon: 'success' });
      setTimeout(() => void Taro.navigateBack().catch(() => Taro.reLaunch({ url: '/pages/index/index' })), 800);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!i) return <View className="container">{error ? <View className="error-box">{error}</View> : <View className="empty">加载中…</View>}</View>;
  const typeName = (code: string) => types.find((t) => t.code === code)?.nameZh ?? code;
  return (
    <View className="container">
      <View className="card">
        <View className="row">
          <Text style={{ fontSize: '40px', fontWeight: 700 }}>{i.roll.rollNo}</Text>
          <Text className="tag">第 {i.revision} 次提交</Text>
        </View>
        <View className="muted" style={{ marginTop: '8px' }}>{i.roll.fabric.code} {i.roll.fabric.nameZh}</View>
        <View className="divider" />
        <View className="kv"><Text className="k">质检员</Text><Text>{i.inspector.name}</Text></View>
        <View className="kv"><Text className="k">方式 / 范围</Text><Text>{MODE_LABELS[i.mode]} · {SCOPE_LABELS[i.scope]}</Text></View>
        {i.template.measurements.map((m) => (
          <View key={m.key} className="kv">
            <Text className="k">{m.label}</Text>
            <Text>{i.measurements.filter((x) => x.itemKey === m.key).map((x) => x.value).join(' / ') || '-'} {m.unit}</Text>
          </View>
        ))}
        {i.remarks && <View className="muted" style={{ marginTop: '8px' }}>备注：{i.remarks}</View>}
      </View>

      {i.result && <EvaluationView e={i.result} />}

      <View className="card">
        <View className="card-title">疵点（{i.defects.length}）</View>
        {i.defects.map((d) => {
          const photos = i.photos.filter((p) => p.defectClientId === d.clientId);
          return (
            <View key={d.clientId} style={{ padding: '12px 0', borderBottom: '1px solid #f1f2f4' }}>
              <View className="row">
                <Text>{d.positionM} m · {typeName(d.defectTypeCode)} · {d.lengthCm}{d.widthCm ? `×${d.widthCm}` : ''} cm</Text>
                <Text className={`tag ${d.severity === 'MINOR' ? 'gray' : 'warn'}`}>{SEVERITY_LABELS[d.severity]} · {d.points ?? '-'} 分</Text>
              </View>
              <View className="thumbs">
                {photos.map((p) => <Image key={p.mediaId} className="thumb" src={p.thumbUrl ?? p.url} mode="aspectFill" onClick={() => preview(photos, p)} />)}
              </View>
            </View>
          );
        })}
      </View>

      <View className="card">
        <View className="card-title">检查点照片</View>
        {i.template.photoCheckpoints.map((c) => {
          const photos = i.photos.filter((p) => p.kind === 'CHECKPOINT' && p.checkpointKey === c.key);
          return (
            <View key={c.key} style={{ marginBottom: '16px' }}>
              <View className="muted">{c.label}</View>
              <View className="thumbs">
                {photos.map((p) => <Image key={p.mediaId} className="thumb" src={p.thumbUrl ?? p.url} mode="aspectFill" onClick={() => preview(photos, p)} />)}
                {!photos.length && <Text className="muted">无</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {i.reviews.length > 0 && (
        <View className="card">
          <View className="card-title">审核历史</View>
          {i.reviews.map((r) => (
            <View key={r.id} className="muted" style={{ padding: '6px 0' }}>
              第 {r.revision} 次 · {r.reviewer.name}：{DECISION_LABELS[r.decision]}{r.isConcession ? '（让步接收）' : ''}{r.comment ? ` · ${r.comment}` : ''}
            </View>
          ))}
        </View>
      )}

      {i.permissions.canReview ? (
        <>
          <View className="card">
            <View className="card-title">审核意见</View>
            {i.overallResult !== 'PASS' && (
              <View className="warn-box">系统判定为"{i.overallResult ? JUDGE_LABELS[i.overallResult] : '-'}"，如审核通过将记为让步接收，必须填写理由。</View>
            )}
            <Textarea className="textarea" value={comment} onInput={(e) => setComment(e.detail.value)} placeholder="退回或判定不合格必须填写原因" maxlength={1000} />
          </View>
          <View className="bottom-bar row-gap">
            <Button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => void decide('RETURN')}>退回</Button>
            <Button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => void decide('REJECT')}>不合格</Button>
            <Button className="btn" style={{ flex: 1.3 }} disabled={busy} onClick={() => void decide('APPROVE')}>通过</Button>
          </View>
        </>
      ) : (
        <View className="muted" style={{ textAlign: 'center' }}>当前状态：{i.status === 'SUBMITTED' ? '待审核（不在你的审核范围内）' : i.status}</View>
      )}
    </View>
  );
}
