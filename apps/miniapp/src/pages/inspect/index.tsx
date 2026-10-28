import { Button, Input, ScrollView, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter, useUnload } from '@tarojs/taro';
import {
  DECISION_LABELS,
  INSPECTION_STATUS_LABELS,
  MeasurementKey,
  MODE_LABELS,
  SCOPE_LABELS,
  SEVERITY_LABELS,
  type InspectionScope,
} from '@fabricqc/shared';
import { useEffect, useMemo, useState } from 'react';
import { EvaluationView } from '@/components/EvaluationView';
import { PhotoGrid } from '@/components/PhotoGrid';
import { SyncBadge } from '@/components/SyncBadge';
import { api, ApiError, errorText, toastError } from '@/lib/api';
import {
  draftFromServer,
  isDirty,
  loadDraft,
  localEvaluation,
  mutateDraft,
  patchDraft,
  removeDraft,
  resolveConflictKeepLocal,
  syncDraft,
  type LocalDraft,
} from '@/lib/draft';
import { takePhoto, uploadPending } from '@/lib/photos';
import type { DefectTypeOption, InspectionDetail } from '@/lib/types';
import { uuid } from '@/lib/uuid';
import './index.scss';

const TABS = ['区段', '检查', '测量', '疵点', '拍照', '结果'] as const;
type Tab = (typeof TABS)[number];

let defectTypesCache: DefectTypeOption[] | null = null;
let templateIdsCache: { reviewRequest: string | null; reviewResult: string | null } | null = null;

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function Inspect() {
  const { params } = useRouter();
  const id = params.id!;
  const [d, setD] = useState<LocalDraft | null>(null);
  const [detail, setDetail] = useState<InspectionDetail | null>(null);
  const [tab, setTab] = useState<Tab>('区段');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [types, setTypes] = useState<DefectTypeOption[]>(defectTypesCache ?? []);

  useEffect(() => {
    const handler = (x: LocalDraft) => setD({ ...x });
    Taro.eventCenter.on(`draft:${id}`, handler);
    return () => {
      Taro.eventCenter.off(`draft:${id}`, handler);
    };
  }, [id]);

  async function load() {
    const local = loadDraft(id);
    if (local) setD(local);
    try {
      const server = await api.get<InspectionDetail>(`/inspections/${id}`);
      setDetail(server);
      const editable = server.status === 'DRAFT' || server.status === 'RETURNED';
      // 本机有未同步修改且服务端仍可编辑：保留本机数据；否则以服务端为准
      if (local && editable && (isDirty(local) || local.photos.some((p) => p.status !== 'uploaded'))) {
        const updated = patchDraft(id, (x) => {
          x.meta.status = server.status;
          x.meta.revision = server.revision;
        });
        setD(updated);
        void uploadPending(id);
        void syncDraft(id);
      } else {
        setD(draftFromServer(server));
      }
      setError('');
    } catch (e) {
      if (!local) setError(errorText(e));
      else if (!(e instanceof ApiError && e.isNetwork)) setError(errorText(e));
    }
    if (!defectTypesCache) {
      api.get<DefectTypeOption[]>('/defect-types?activeOnly=true').then((t) => {
        defectTypesCache = t;
        setTypes(t);
      }).catch(() => undefined);
    }
    if (!templateIdsCache) {
      api.get<{ templates: typeof templateIdsCache }>('/notifications/wechat-subscriptions')
        .then((r) => (templateIdsCache = r.templates))
        .catch(() => undefined);
    }
  }

  useDidShow(() => void load());
  useUnload(() => void syncDraft(id));

  const evaluation = useMemo(() => {
    if (!d) return null;
    if (!isDirty(d) && d.serverEvaluation) return { e: d.serverEvaluation, label: '服务端计算' };
    const e = localEvaluation(d);
    return e ? { e, label: '本机预估' } : null;
  }, [d]);

  if (!d) {
    return <View className="container">{error ? <View className="error-box">{error}</View> : <View className="empty">加载中…</View>}</View>;
  }

  const editable = d.meta.status === 'DRAFT' || d.meta.status === 'RETURNED';
  const tpl = d.meta.template;
  const spec = d.meta.spec;
  const rollLength = [...d.measurements].filter((m) => m.itemKey === MeasurementKey.ROLL_LENGTH).sort((a, b) => a.seq - b.seq).pop()?.value;
  const typeName = (code: string) => types.find((t) => t.code === code)?.nameZh ?? code;
  const lastReturn = detail?.reviews.filter((r) => r.decision === 'RETURN').pop();

  const mutate = (fn: (x: LocalDraft) => void) => {
    const x = mutateDraft(id, fn);
    if (x) setD({ ...x });
  };

  function setScope(scope: InspectionScope) {
    mutate((x) => {
      x.scope = scope;
      if (scope === 'FULL') x.segments = rollLength ? [{ startM: 0, endM: rollLength }] : [];
    });
  }

  function setReading(itemKey: string, seq: number, value: string) {
    const v = num(value);
    mutate((x) => {
      x.measurements = x.measurements.filter((m) => !(m.itemKey === itemKey && m.seq === seq));
      if (v !== null) x.measurements.push({ itemKey, seq, value: v });
      // 整卷全检：区段自动跟随实测卷长
      if (itemKey === MeasurementKey.ROLL_LENGTH && x.scope === 'FULL') {
        const len = [...x.measurements].filter((m) => m.itemKey === itemKey).sort((a, b) => a.seq - b.seq).pop()?.value;
        x.segments = len ? [{ startM: 0, endM: len }] : [];
      }
    });
  }

  async function submit() {
    if (!d) return;
    // 订阅消息授权必须在点击事件中直接调用
    const tmpl = templateIdsCache?.reviewResult;
    if (tmpl) {
      Taro.requestSubscribeMessage({ tmplIds: [tmpl], entityIds: [] } as unknown as Taro.requestSubscribeMessage.Option)
        .then((r) => {
          const accepted = (r as unknown as Record<string, string>)[tmpl] === 'accept';
          return api.post('/notifications/wechat-subscriptions', { results: [{ templateId: tmpl, accepted }] });
        })
        .catch(() => undefined);
    }
    setSubmitting(true);
    try {
      await uploadPending(id);
      let cur = loadDraft(id)!;
      const notUploaded = cur.photos.filter((p) => p.status !== 'uploaded').length;
      if (notUploaded) {
        void Taro.showModal({ title: '照片未上传', content: `还有 ${notUploaded} 张照片没有上传成功，请检查网络后在"拍照"页点击失败的照片重试。`, showCancel: false });
        return;
      }
      await syncDraft(id);
      cur = loadDraft(id)!;
      if (isDirty(cur) || cur.syncState !== 'idle') {
        void Taro.showModal({ title: '尚未同步', content: cur.syncError ?? '草稿还没有同步到服务器，请检查网络后重试。数据已保存在本机。', showCancel: false });
        return;
      }
      const confirm = await Taro.showModal({ title: '提交审核', content: '提交后记录将锁定，等待主管审核。确认提交？' });
      if (!confirm.confirm) return;
      const key = cur.submitKey ?? uuid();
      patchDraft(id, (x) => {
        x.submitKey = key;
      });
      const r = await api.post<{ revision: number }>(`/inspections/${id}/submit`, { idempotencyKey: key, draftVersion: cur.baseVersion });
      removeDraft(id);
      void Taro.showToast({ title: `已提交（第 ${r.revision} 次）`, icon: 'success' });
      setTimeout(() => void Taro.navigateBack().catch(() => Taro.reLaunch({ url: '/pages/index/index' })), 900);
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        void Taro.showModal({ title: '网络异常', content: '无法确认是否提交成功。请恢复网络后再次点击提交，系统不会重复提交。', showCancel: false });
      } else {
        patchDraft(id, (x) => {
          x.submitKey = null;
        });
        toastError(e);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="inspect">
      <View className="head">
        <View className="row">
          <Text className="roll-no">{d.meta.roll.rollNo}</Text>
          {editable ? <SyncBadge d={d} /> : <Text className="tag">{INSPECTION_STATUS_LABELS[d.meta.status]}</Text>}
        </View>
        <View className="muted">
          {d.meta.roll.fabric.code} {d.meta.roll.fabric.nameZh} · {MODE_LABELS[d.mode]} · {SCOPE_LABELS[d.scope]}
        </View>
        {d.syncState === 'conflict' && (
          <View className="error-box" style={{ marginTop: '12px' }}>
            服务器上的草稿已被其他设备修改。
            <Text className="link" onClick={() => void resolveConflictKeepLocal(id)}>以本机为准覆盖</Text>
            <Text className="link" onClick={() => { removeDraft(id); void load(); }}>放弃本机修改</Text>
          </View>
        )}
        {d.meta.status === 'RETURNED' && lastReturn && (
          <View className="warn-box" style={{ marginTop: '12px', marginBottom: 0 }}>主管退回：{lastReturn.comment}</View>
        )}
      </View>

      <ScrollView scrollX className="tabs">
        {TABS.map((t) => (
          <View key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</View>
        ))}
      </ScrollView>

      <View className="container" style={{ paddingTop: '16px' }}>
        {error && <View className="error-box">{error}</View>}

        {tab === '区段' && (
          <View>
            <View className="card">
              <View className="card-title">规格</View>
              <View className="kv"><Text className="k">门幅 / 可裁门幅</Text><Text>{spec.widthCm ?? '-'} / {spec.cuttableWidthCm ?? '-'} cm</Text></View>
              <View className="kv"><Text className="k">克重</Text><Text>{spec.gsm ?? '-'} g/m²</Text></View>
              <View className="kv"><Text className="k">标称长度</Text><Text>{spec.nominalLengthM ?? '-'} m</Text></View>
              <View className="kv"><Text className="k">缸号 / 色号</Text><Text>{d.meta.roll.dyeLotNo ?? '-'} / {d.meta.roll.colorCode ?? '-'}</Text></View>
            </View>
            <View className="card">
              <View className="card-title">检验范围</View>
              <View className="seg">
                {(['FULL', 'PARTIAL', 'SAMPLING'] as const).map((s) => (
                  <View key={s} className={`seg-item ${d.scope === s ? 'active' : ''}`} onClick={() => editable && setScope(s)}>{SCOPE_LABELS[s]}</View>
                ))}
              </View>
              <View className="divider" />
              {d.scope === 'FULL' ? (
                <View className="muted">
                  整卷全检区段：{rollLength ? `0 ~ ${rollLength} m（跟随实测卷长）` : '请先在"测量"中录入实测卷长'}
                </View>
              ) : (
                <View>
                  {d.segments.map((s, i) => (
                    <View key={i} className="row-gap seg-row">
                      <Input className="input flex1" type="digit" disabled={!editable} value={String(s.startM)} placeholder="起 m"
                        onBlur={(e) => mutate((x) => { x.segments[i].startM = num(e.detail.value) ?? 0; })} />
                      <Text>~</Text>
                      <Input className="input flex1" type="digit" disabled={!editable} value={String(s.endM)} placeholder="止 m"
                        onBlur={(e) => mutate((x) => { x.segments[i].endM = num(e.detail.value) ?? 0; })} />
                      {editable && <Button className="btn small ghost" onClick={() => mutate((x) => { x.segments.splice(i, 1); })}>删除</Button>}
                    </View>
                  ))}
                  {editable && (
                    <Button className="btn secondary small" onClick={() => mutate((x) => {
                      const last = x.segments[x.segments.length - 1];
                      const start = last ? last.endM : 0;
                      x.segments.push({ startM: start, endM: start + 10 });
                    })}>＋ 添加检验区段</Button>
                  )}
                  <View className="muted" style={{ marginTop: '12px' }}>
                    已检 {d.segments.reduce((a, s) => a + Math.max(0, s.endM - s.startM), 0).toFixed(2)} m，结论将注明"仅基于{SCOPE_LABELS[d.scope]}"
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {tab === '检查' && (
          <View>
            {tpl.checklist.map((c) => {
              const r = d.checklist.find((x) => x.key === c.key);
              const set = (status: 'OK' | 'NG' | 'NA') =>
                mutate((x) => {
                  x.checklist = [...x.checklist.filter((y) => y.key !== c.key), { key: c.key, status, note: r?.note ?? null }];
                });
              return (
                <View key={c.key} className="card">
                  <View className="card-title">{c.label}{c.required && <Text className="req">*</Text>}</View>
                  <View className="seg">
                    <View className={`seg-item ok ${r?.status === 'OK' ? 'active' : ''}`} onClick={() => editable && set('OK')}>合格</View>
                    <View className={`seg-item ng ${r?.status === 'NG' ? 'active' : ''}`} onClick={() => editable && set('NG')}>不合格</View>
                    <View className={`seg-item ${r?.status === 'NA' ? 'active' : ''}`} onClick={() => editable && set('NA')}>不适用</View>
                  </View>
                  {r?.status === 'NG' && (
                    <Input className="input" style={{ marginTop: '16px' }} disabled={!editable} placeholder="说明问题" value={r.note ?? ''}
                      onBlur={(e) => mutate((x) => { const y = x.checklist.find((z) => z.key === c.key); if (y) y.note = e.detail.value; })} />
                  )}
                </View>
              );
            })}
          </View>
        )}

        {tab === '测量' && (
          <View>
            {tpl.measurements.map((m) => {
              const readings = d.measurements.filter((x) => x.itemKey === m.key).sort((a, b) => a.seq - b.seq);
              const count = Math.max(m.minReadings, readings.length ? Math.max(...readings.map((r) => r.seq)) : 0);
              const specValue = m.specField ? spec[m.specField] : null;
              return (
                <View key={m.key} className="card">
                  <View className="row">
                    <Text className="card-title" style={{ marginBottom: 0 }}>{m.label}{m.required && <Text className="req">*</Text>}</Text>
                    <Text className="muted">{specValue !== null && specValue !== undefined ? `规格 ${specValue} ${m.unit}` : m.unit}</Text>
                  </View>
                  <View className="readings">
                    {Array.from({ length: count }, (_, i) => i + 1).map((seq) => (
                      <Input key={seq} className="input reading" type="digit" disabled={!editable} placeholder={`读数 ${seq}`}
                        value={readings.find((r) => r.seq === seq)?.value?.toString() ?? ''}
                        onBlur={(e) => setReading(m.key, seq, e.detail.value)} />
                    ))}
                  </View>
                  {editable && (
                    <Button className="btn small ghost" style={{ marginTop: '12px' }} onClick={() => setReading(m.key, count + 1, '')}>
                      ＋ 增加读数
                    </Button>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {tab === '疵点' && (
          <View>
            {!d.defects.length && <View className="empty">还没有记录疵点</View>}
            {[...d.defects].sort((a, b) => a.positionM - b.positionM).map((x) => {
              const pts = evaluation?.e.fourPoint.scoring.defectScores.find((s) => s.clientId === x.clientId)?.points;
              const photos = d.photos.filter((p) => p.defectClientId === x.clientId).length;
              return (
                <View key={x.clientId} className="card defect" onClick={() => Taro.navigateTo({ url: `/pages/defect/index?inspectionId=${id}&clientId=${x.clientId}` })}>
                  <View className="row">
                    <Text className="defect-name">{x.positionM} m · {typeName(x.defectTypeCode)}</Text>
                    <Text className={`tag ${x.severity === 'CRITICAL' ? 'danger' : x.severity === 'MAJOR' ? 'warn' : 'gray'}`}>{SEVERITY_LABELS[x.severity]}</Text>
                  </View>
                  <View className="muted" style={{ marginTop: '8px' }}>
                    {x.lengthCm}{x.widthCm ? ` × ${x.widthCm}` : ''} cm{x.widthPositionCm !== null ? ` · 幅宽 ${x.widthPositionCm} cm` : ''} · {pts ?? '-'} 分 ·{' '}
                    <Text style={{ color: photos ? '#15803d' : '#b91c1c' }}>{photos ? `${photos} 张照片` : '缺照片'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {tab === '拍照' && (
          <View>
            {tpl.photoCheckpoints.map((c) => {
              const photos = d.photos.filter((p) => p.kind === 'CHECKPOINT' && p.checkpointKey === c.key);
              return (
                <View key={c.key} className="card">
                  <View className="row">
                    <Text className="card-title" style={{ marginBottom: 0 }}>{c.label}{c.required && <Text className="req">*</Text>}</Text>
                    <Text className={`tag ${photos.length >= c.minPhotos ? 'success' : 'gray'}`}>{photos.length}/{c.minPhotos}</Text>
                  </View>
                  <PhotoGrid inspectionId={id} photos={photos} editable={editable} />
                  {editable && (
                    <View className="row-gap" style={{ marginTop: '16px' }}>
                      <Button className="btn flex1" onClick={() => void takePhoto(id, { kind: 'CHECKPOINT', checkpointKey: c.key })}>拍照</Button>
                      <Button className="btn ghost flex1" onClick={() => void takePhoto(id, { kind: 'CHECKPOINT', checkpointKey: c.key }, 'album')}>相册</Button>
                    </View>
                  )}
                </View>
              );
            })}
            <View className="muted" style={{ padding: '0 8px' }}>疵点照片在"疵点"页对应疵点中拍摄。</View>
          </View>
        )}

        {tab === '结果' && (
          <View>
            {evaluation ? <EvaluationView e={evaluation.e} label={evaluation.label} /> : <View className="empty">数据不足，暂无法计算</View>}
            <View className="card">
              <View className="card-title">质检员备注</View>
              <Textarea className="textarea" disabled={!editable} value={d.remarks} placeholder="可选" maxlength={2000}
                onBlur={(e) => mutate((x) => { x.remarks = e.detail.value; })} />
            </View>
            {detail?.reviews.map((r) => (
              <View key={r.id} className="card">
                <View className="row">
                  <Text>第 {r.revision} 次提交 · {r.reviewer.name}</Text>
                  <Text className="tag">{DECISION_LABELS[r.decision]}</Text>
                </View>
                {r.comment && <View className="muted" style={{ marginTop: '8px' }}>{r.comment}</View>}
              </View>
            ))}
          </View>
        )}
      </View>

      {editable && (
        <View className="bottom-bar row-gap">
          {tab === '疵点' ? (
            <Button className="btn flex1" onClick={() => Taro.navigateTo({ url: `/pages/defect/index?inspectionId=${id}` })}>＋ 记录疵点</Button>
          ) : tab === '结果' ? (
            <Button className="btn flex1" loading={submitting} disabled={submitting} onClick={() => void submit()}>
              {d.meta.status === 'RETURNED' ? '重新提交审核' : '提交审核'}
            </Button>
          ) : (
            <>
              <Button className="btn ghost flex1" onClick={() => Taro.navigateTo({ url: `/pages/defect/index?inspectionId=${id}` })}>＋ 疵点</Button>
              <Button className="btn flex1" onClick={() => setTab(TABS[Math.min(TABS.length - 1, TABS.indexOf(tab) + 1)])}>下一步</Button>
            </>
          )}
        </View>
      )}
    </View>
  );
}

