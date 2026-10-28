import { Button, Input, Text, Textarea, View } from '@tarojs/components';
import Taro, { useDidShow, useRouter } from '@tarojs/taro';
import { DEFECT_SEVERITIES, SEVERITY_LABELS, type DefectSeverity } from '@fabricqc/shared';
import { useEffect, useMemo, useState } from 'react';
import { PhotoGrid } from '@/components/PhotoGrid';
import { api } from '@/lib/api';
import { loadDraft, mutateDraft, type LocalDraft, type LocalDefect } from '@/lib/draft';
import { takePhoto } from '@/lib/photos';
import type { DefectTypeOption } from '@/lib/types';
import { uuid } from '@/lib/uuid';
import './index.scss';

let typesCache: DefectTypeOption[] | null = null;

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function DefectPage() {
  const { params } = useRouter();
  const inspectionId = params.inspectionId!;
  const [clientId, setClientId] = useState(params.clientId ?? uuid());
  const isNew = !params.clientId;
  const [types, setTypes] = useState<DefectTypeOption[]>(typesCache ?? []);
  const [d, setD] = useState<LocalDraft | null>(loadDraft(inspectionId));
  const existing = d?.defects.find((x) => x.clientId === clientId);
  const [form, setForm] = useState({
    defectTypeCode: existing?.defectTypeCode ?? '',
    severity: (existing?.severity ?? 'MINOR') as DefectSeverity,
    positionM: existing ? String(existing.positionM) : '',
    lengthCm: existing ? String(existing.lengthCm) : '',
    widthCm: existing?.widthCm != null ? String(existing.widthCm) : '',
    widthPositionCm: existing?.widthPositionCm != null ? String(existing.widthPositionCm) : '',
    remark: existing?.remark ?? '',
  });
  const editable = d?.meta.status === 'DRAFT' || d?.meta.status === 'RETURNED';

  useEffect(() => {
    if (!typesCache) {
      api.get<DefectTypeOption[]>('/defect-types?activeOnly=true').then((t) => {
        typesCache = t;
        setTypes(t);
      }).catch(() => undefined);
    }
    const h = (x: LocalDraft) => setD({ ...x });
    Taro.eventCenter.on(`draft:${inspectionId}`, h);
    return () => {
      Taro.eventCenter.off(`draft:${inspectionId}`, h);
    };
  }, [inspectionId]);
  useDidShow(() => setD(loadDraft(inspectionId)));

  const photos = useMemo(() => d?.photos.filter((p) => p.kind === 'DEFECT' && p.defectClientId === clientId) ?? [], [d, clientId]);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  function build(): LocalDefect | null {
    const positionM = num(form.positionM);
    const lengthCm = num(form.lengthCm);
    if (!form.defectTypeCode) return toast('请选择疵点类型');
    if (positionM === null || positionM < 0) return toast('请填写米位');
    if (lengthCm === null || lengthCm <= 0) return toast('请填写疵点长度');
    return {
      clientId,
      defectTypeCode: form.defectTypeCode,
      severity: form.severity,
      positionM,
      lengthCm,
      widthCm: num(form.widthCm),
      widthPositionCm: num(form.widthPositionCm),
      remark: form.remark || null,
    };
  }

  function toast(title: string): null {
    void Taro.showToast({ title, icon: 'none' });
    return null;
  }

  function save(next: boolean) {
    const x = build();
    if (!x) return;
    mutateDraft(inspectionId, (dr) => {
      dr.defects = [...dr.defects.filter((y) => y.clientId !== clientId), x];
    });
    if (!photos.length) void Taro.showToast({ title: '已保存，请补拍疵点照片', icon: 'none' });
    else void Taro.showToast({ title: '已保存', icon: 'success' });
    if (next) {
      // 连续录入：保留疵点类型和严重度，米位清空
      setClientId(uuid());
      setForm({ ...form, positionM: '', lengthCm: '', widthCm: '', widthPositionCm: '', remark: '' });
    } else {
      setTimeout(() => void Taro.navigateBack(), 500);
    }
  }

  function remove() {
    void Taro.showModal({ title: '删除该疵点？', content: '关联的照片也会一起删除' }).then((r) => {
      if (!r.confirm) return;
      mutateDraft(inspectionId, (dr) => {
        dr.defects = dr.defects.filter((y) => y.clientId !== clientId);
        dr.photos = dr.photos.filter((p) => p.defectClientId !== clientId);
      });
      void Taro.navigateBack();
    });
  }

  return (
    <View className="container defect-page">
      <View className="card">
        <View className="card-title">疵点类型</View>
        <View className="types">
          {types.map((t) => (
            <View
              key={t.code}
              className={`type ${form.defectTypeCode === t.code ? 'active' : ''}`}
              onClick={() => editable && setForm({ ...form, defectTypeCode: t.code, severity: existing ? form.severity : t.defaultSeverity })}
            >
              {t.nameZh}
            </View>
          ))}
        </View>
        {!types.length && <View className="muted">离线时无法加载疵点类型，请联网后重试</View>}
      </View>

      <View className="card">
        <View className="grid2">
          <View className="field">
            <View className="label">米位 (m)*</View>
            <Input className="input big" type="digit" disabled={!editable} value={form.positionM} onInput={(e) => set('positionM', e.detail.value)} placeholder="如 35.6" />
          </View>
          <View className="field">
            <View className="label">长度 (cm)*</View>
            <Input className="input big" type="digit" disabled={!editable} value={form.lengthCm} onInput={(e) => set('lengthCm', e.detail.value)} />
          </View>
        </View>
        <View className="grid2">
          <View className="field">
            <View className="label">宽度 (cm)</View>
            <Input className="input" type="digit" disabled={!editable} value={form.widthCm} onInput={(e) => set('widthCm', e.detail.value)} />
          </View>
          <View className="field">
            <View className="label">幅宽方向位置 (cm)</View>
            <Input className="input" type="digit" disabled={!editable} value={form.widthPositionCm} onInput={(e) => set('widthPositionCm', e.detail.value)} placeholder="距左布边" />
          </View>
        </View>
        <View className="label">严重程度</View>
        <View className="seg">
          {DEFECT_SEVERITIES.map((s) => (
            <View key={s} className={`seg-item ${form.severity === s ? (s === 'MINOR' ? 'active' : 'ng active') : ''}`} onClick={() => editable && setForm({ ...form, severity: s })}>
              {SEVERITY_LABELS[s]}
            </View>
          ))}
        </View>
        <View className="field" style={{ marginTop: '24px', marginBottom: 0 }}>
          <View className="label">备注</View>
          <Textarea className="textarea" disabled={!editable} value={form.remark} onInput={(e) => set('remark', e.detail.value)} maxlength={500} />
        </View>
      </View>

      <View className="card">
        <View className="row">
          <Text className="card-title" style={{ marginBottom: 0 }}>疵点照片</Text>
          <Text className={`tag ${photos.length ? 'success' : 'danger'}`}>{photos.length ? `${photos.length} 张` : '必拍'}</Text>
        </View>
        <PhotoGrid inspectionId={inspectionId} photos={photos} editable={editable} />
        {editable && (
          <View className="row-gap" style={{ marginTop: '16px' }}>
            <Button className="btn flex1" onClick={() => void takePhoto(inspectionId, { kind: 'DEFECT', defectClientId: clientId })}>拍照</Button>
            <Button className="btn ghost flex1" onClick={() => void takePhoto(inspectionId, { kind: 'DEFECT', defectClientId: clientId }, 'album')}>相册</Button>
          </View>
        )}
      </View>

      {editable && (
        <View className="bottom-bar row-gap">
          {!isNew && <Button className="btn ghost small" onClick={remove}>删除</Button>}
          <Button className="btn secondary flex1" onClick={() => save(true)}>保存并继续</Button>
          <Button className="btn flex1" onClick={() => save(false)}>保存</Button>
        </View>
      )}
    </View>
  );
}
