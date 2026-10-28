import {
  DEFECT_SEVERITIES,
  DEV_DEFAULT_FOUR_POINT_RULES,
  INSPECTION_SCOPES,
  SCOPE_LABELS,
  SEVERITY_LABELS,
  SPEC_FIELDS,
  standardRulesSchema,
  type DefectSeverity,
  type InspectionScope,
  type StandardRulesInput,
} from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmButton, DevDefaultBadge, PageHeader, QueryState } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { cn, fmtDate, toNumOrNull } from '@/lib/utils';
import { Section, SPEC_FIELD_LABELS, useDefectTypes } from './StandardsPage';

interface Version {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  rules: StandardRulesInput;
  notes: string | null;
  isDevDefault: boolean;
  publishedAt: string | null;
  createdAt: string;
}

interface StandardDetail {
  id: string;
  code: string;
  name: string;
  kind: 'FOUR_POINT' | 'CUSTOMER';
  description: string | null;
  customer: { name: string } | null;
  versions: Version[];
}

type Band = { maxCm: string; points: string };
type Special = { mode: 'FIXED_POINTS' | 'BY_SIZE' | 'PER_LINEAR_UNIT'; codes: string[]; points: string; bands: Band[]; note: string };
type Limit = {
  itemKey: string;
  label: string;
  mode: 'ABSOLUTE' | 'RELATIVE_TO_SPEC';
  specField: string;
  min: string;
  max: string;
  minPct: string;
  maxPct: string;
  aggregate: 'EACH' | 'AVG';
  required: boolean;
};

interface Form {
  hasFourPoint: boolean;
  dimensionBasis: 'LENGTH' | 'MAX_DIMENSION';
  bands: Band[];
  specials: Special[];
  capEnabled: boolean;
  capUnit: string;
  capMax: string;
  areaUnit: 'PER_100_SQ_YD' | 'PER_100_SQ_M';
  maxNormalizedPoints: string;
  maxTotalPoints: string;
  maxDefectCount: string;
  forbidden: string[];
  perType: { code: string; max: string }[];
  failOnSeverity: '' | DefectSeverity;
  limits: Limit[];
  requiredScope: '' | InspectionScope;
  requireDefectPhoto: boolean;
}

const s = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const n = (v: string) => toNumOrNull(v) ?? undefined;
const toBands = (b: { maxCm: number | null; points: number }[] | undefined): Band[] =>
  (b ?? []).map((x) => ({ maxCm: s(x.maxCm), points: s(x.points) }));
const fromBands = (b: Band[]) => b.map((x) => ({ maxCm: toNumOrNull(x.maxCm), points: Number(x.points) }));

function toForm(r: StandardRulesInput): Form {
  const fp = r.fourPoint;
  return {
    hasFourPoint: !!fp,
    dimensionBasis: fp?.dimensionBasis ?? 'MAX_DIMENSION',
    bands: toBands(fp?.bands) .length ? toBands(fp?.bands) : [{ maxCm: '', points: '4' }],
    specials: (fp?.specialRules ?? []).map((x) => ({
      mode: x.mode,
      codes: x.defectTypeCodes,
      points: 'points' in x ? s(x.points) : '',
      bands: 'bands' in x ? toBands(x.bands) : [{ maxCm: '', points: '4' }],
      note: x.note ?? '',
    })),
    capEnabled: !!fp?.maxPointsPerLinearUnit,
    capUnit: s(fp?.maxPointsPerLinearUnit?.unitLengthM ?? 0.9144),
    capMax: s(fp?.maxPointsPerLinearUnit?.maxPoints ?? 4),
    areaUnit: fp?.areaUnit ?? 'PER_100_SQ_YD',
    maxNormalizedPoints: s(r.thresholds?.maxNormalizedPoints),
    maxTotalPoints: s(r.thresholds?.maxTotalPoints),
    maxDefectCount: s(r.thresholds?.maxDefectCount),
    forbidden: r.forbiddenDefectTypes ?? [],
    perType: Object.entries(r.maxDefectCountByType ?? {}).map(([code, max]) => ({ code, max: String(max) })),
    failOnSeverity: r.failOnSeverity ?? '',
    limits: (r.measurementLimits ?? []).map((l) => ({
      itemKey: l.itemKey,
      label: l.label,
      mode: l.mode,
      specField: l.specField ?? '',
      min: s(l.min),
      max: s(l.max),
      minPct: s(l.minPct),
      maxPct: s(l.maxPct),
      aggregate: l.aggregate ?? 'EACH',
      required: l.required ?? true,
    })),
    requiredScope: r.requiredScope ?? '',
    requireDefectPhoto: r.requireDefectPhoto ?? true,
  };
}

function fromForm(f: Form): StandardRulesInput {
  return {
    schemaVersion: 1,
    ...(f.hasFourPoint
      ? {
          fourPoint: {
            dimensionBasis: f.dimensionBasis,
            bands: fromBands(f.bands),
            specialRules: f.specials.map((x) =>
              x.mode === 'BY_SIZE'
                ? { mode: x.mode, defectTypeCodes: x.codes, bands: fromBands(x.bands), note: x.note || undefined }
                : { mode: x.mode, defectTypeCodes: x.codes, points: Number(x.points), note: x.note || undefined },
            ),
            maxPointsPerLinearUnit: f.capEnabled ? { unitLengthM: Number(f.capUnit), maxPoints: Number(f.capMax) } : null,
            areaUnit: f.areaUnit,
          },
        }
      : {}),
    thresholds: { maxNormalizedPoints: n(f.maxNormalizedPoints), maxTotalPoints: n(f.maxTotalPoints), maxDefectCount: n(f.maxDefectCount) },
    forbiddenDefectTypes: f.forbidden,
    maxDefectCountByType: Object.fromEntries(f.perType.filter((p) => p.code).map((p) => [p.code, Number(p.max)])),
    failOnSeverity: f.failOnSeverity || null,
    measurementLimits: f.limits.map((l) => ({
      itemKey: l.itemKey,
      label: l.label,
      mode: l.mode,
      specField: (l.specField || undefined) as (typeof SPEC_FIELDS)[number] | undefined,
      min: l.mode === 'ABSOLUTE' ? n(l.min) : undefined,
      max: l.mode === 'ABSOLUTE' ? n(l.max) : undefined,
      minPct: l.mode === 'RELATIVE_TO_SPEC' ? n(l.minPct) : undefined,
      maxPct: l.mode === 'RELATIVE_TO_SPEC' ? n(l.maxPct) : undefined,
      aggregate: l.aggregate,
      required: l.required,
    })),
    requiredScope: f.requiredScope || null,
    requireDefectPhoto: f.requireDefectPhoto,
  };
}

function BandsEditor({ bands, onChange, disabled, unit = 'cm' }: { bands: Band[]; onChange: (b: Band[]) => void; disabled?: boolean; unit?: string }) {
  return (
    <div className="space-y-1.5">
      {bands.map((b, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-10 text-muted-foreground">≤</span>
          <Input className="w-28" disabled={disabled} placeholder="空=无上限" value={b.maxCm} onChange={(e) => onChange(bands.map((x, j) => (j === i ? { ...x, maxCm: e.target.value } : x)))} />
          <span className="text-muted-foreground">{unit} →</span>
          <Input className="w-20" disabled={disabled} value={b.points} onChange={(e) => onChange(bands.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))} />
          <span className="text-muted-foreground">分</span>
          {!disabled && bands.length > 1 && (
            <Button variant="ghost" size="icon" onClick={() => onChange(bands.filter((_, j) => j !== i))}><Trash2 /></Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button size="sm" variant="outline" onClick={() => onChange([...bands.slice(0, -1), { maxCm: '', points: '' }, bands[bands.length - 1]])}>
          <Plus /> 插入分档
        </Button>
      )}
    </div>
  );
}

function CodePicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const types = useDefectTypes();
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.data?.map((t) => {
        const on = value.includes(t.code);
        return (
          <button
            key={t.code}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((c) => c !== t.code) : [...value, t.code])}
            className={cn('rounded-full border px-2 py-0.5 text-xs', on ? 'border-primary bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary')}
          >
            {t.nameZh}
          </button>
        );
      })}
    </div>
  );
}

function RulesEditor({ initial, kind, readOnly, onSave, saving }: { initial: StandardRulesInput; kind: 'FOUR_POINT' | 'CUSTOMER'; readOnly: boolean; onSave?: (r: StandardRulesInput, notes: string) => void; saving?: boolean }) {
  const [f, setF] = useState<Form>(() => ({ ...toForm(initial), hasFourPoint: kind === 'FOUR_POINT' || !!initial.fourPoint }));
  const [notes, setNotes] = useState('');
  const types = useDefectTypes();
  const rules = useMemo(() => fromForm(f), [f]);
  const parsed = standardRulesSchema.safeParse(rules);
  const errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}：${i.message}`);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const d = readOnly;

  return (
    <div className="space-y-2">
      {f.hasFourPoint && (
        <Card>
          <CardHeader><CardTitle>四分制计分</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {kind === 'CUSTOMER' && (
              <p className="text-sm text-muted-foreground">该客户标准使用自己的计分方式，而不是任务中的四分制标准。</p>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="尺寸取值">
                <NativeSelect disabled={d} value={f.dimensionBasis} onChange={(e) => set('dimensionBasis', e.target.value as Form['dimensionBasis'])}>
                  <option value="MAX_DIMENSION">长、宽取较大值</option>
                  <option value="LENGTH">仅疵点长度</option>
                </NativeSelect>
              </Field>
              <Field label="标准化单位">
                <NativeSelect disabled={d} value={f.areaUnit} onChange={(e) => set('areaUnit', e.target.value as Form['areaUnit'])}>
                  <option value="PER_100_SQ_YD">分 / 100 平方码</option>
                  <option value="PER_100_SQ_M">分 / 100 平方米</option>
                </NativeSelect>
              </Field>
              <Field label="每线性单位封顶">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Checkbox disabled={d} checked={f.capEnabled} onChange={(e) => set('capEnabled', e.target.checked)} />
                  {f.capEnabled && (
                    <>
                      每 <Input disabled={d} className="w-20" value={f.capUnit} onChange={(e) => set('capUnit', e.target.value)} /> m 最多
                      <Input disabled={d} className="w-14" value={f.capMax} onChange={(e) => set('capMax', e.target.value)} /> 分
                    </>
                  )}
                </div>
              </Field>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">尺寸分档（1 英寸 = 2.54 cm）</div>
              <BandsEditor disabled={d} bands={f.bands} onChange={(b) => set('bands', b)} />
            </div>
            <Section title="特殊疵点规则" onAdd={d ? undefined : () => set('specials', [...f.specials, { mode: 'FIXED_POINTS', codes: [], points: '4', bands: [{ maxCm: '', points: '4' }], note: '' }])}>
              {f.specials.map((sp, i) => {
                const upd = (p: Partial<Special>) => set('specials', f.specials.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <NativeSelect disabled={d} className="w-48" value={sp.mode} onChange={(e) => upd({ mode: e.target.value as Special['mode'] })}>
                        <option value="FIXED_POINTS">固定扣分</option>
                        <option value="BY_SIZE">按尺寸分档</option>
                        <option value="PER_LINEAR_UNIT">连续性：每线性单位扣分</option>
                      </NativeSelect>
                      {sp.mode !== 'BY_SIZE' && (
                        <>
                          <Input disabled={d} className="w-20" value={sp.points} onChange={(e) => upd({ points: e.target.value })} /> 分
                        </>
                      )}
                      <Input disabled={d} className="flex-1" placeholder="说明" value={sp.note} onChange={(e) => upd({ note: e.target.value })} />
                      {!d && <Button variant="ghost" size="icon" onClick={() => set('specials', f.specials.filter((_, j) => j !== i))}><Trash2 /></Button>}
                    </div>
                    <CodePicker disabled={d} value={sp.codes} onChange={(codes) => upd({ codes })} />
                    {sp.mode === 'BY_SIZE' && <BandsEditor disabled={d} bands={sp.bands} onChange={(bands) => upd({ bands })} />}
                  </div>
                );
              })}
            </Section>
          </CardContent>
        </Card>
      )}
      {kind === 'CUSTOMER' && !d && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={f.hasFourPoint} onChange={(e) => set('hasFourPoint', e.target.checked)} />
          客户使用自己的计分方式（不勾选则使用任务中四分制标准的得分）
        </label>
      )}

      <Card>
        <CardHeader><CardTitle>判定规则</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="标准化得分上限" hint="超过即不合格"><Input disabled={d} value={f.maxNormalizedPoints} onChange={(e) => set('maxNormalizedPoints', e.target.value)} /></Field>
            <Field label="单卷总扣分上限"><Input disabled={d} value={f.maxTotalPoints} onChange={(e) => set('maxTotalPoints', e.target.value)} /></Field>
            <Field label="疵点总数上限"><Input disabled={d} value={f.maxDefectCount} onChange={(e) => set('maxDefectCount', e.target.value)} /></Field>
            <Field label="严重度一票否决">
              <NativeSelect disabled={d} value={f.failOnSeverity} onChange={(e) => set('failOnSeverity', e.target.value as Form['failOnSeverity'])}>
                <option value="">不启用</option>
                {DEFECT_SEVERITIES.map((x) => <option key={x} value={x}>出现{SEVERITY_LABELS[x]}及以上即不合格</option>)}
              </NativeSelect>
            </Field>
            <Field label="要求的检验范围">
              <NativeSelect disabled={d} value={f.requiredScope} onChange={(e) => set('requiredScope', e.target.value as Form['requiredScope'])}>
                <option value="">不限</option>
                {INSPECTION_SCOPES.map((x) => <option key={x} value={x}>{SCOPE_LABELS[x]}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <Checkbox disabled={d} checked={f.requireDefectPhoto} onChange={(e) => set('requireDefectPhoto', e.target.checked)} /> 每个疵点必须拍照
            </label>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">禁止出现的疵点</div>
            <CodePicker disabled={d} value={f.forbidden} onChange={(v) => set('forbidden', v)} />
          </div>
          <Section title="按类型限制数量" onAdd={d ? undefined : () => set('perType', [...f.perType, { code: '', max: '0' }])}>
            {f.perType.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <NativeSelect disabled={d} className="w-48" value={p.code} onChange={(e) => set('perType', f.perType.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}>
                  <option value="">选择疵点</option>
                  {types.data?.map((t) => <option key={t.code} value={t.code}>{t.nameZh}</option>)}
                </NativeSelect>
                最多 <Input disabled={d} className="w-20" value={p.max} onChange={(e) => set('perType', f.perType.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} /> 个
                {!d && <Button variant="ghost" size="icon" onClick={() => set('perType', f.perType.filter((_, j) => j !== i))}><Trash2 /></Button>}
              </div>
            ))}
          </Section>
          <Section
            title="测量值限值"
            onAdd={d ? undefined : () => set('limits', [...f.limits, { itemKey: 'gsm', label: '克重', mode: 'RELATIVE_TO_SPEC', specField: 'gsm', min: '', max: '', minPct: '-5', maxPct: '5', aggregate: 'EACH', required: true }])}
          >
            {f.limits.map((l, i) => {
              const upd = (p: Partial<Limit>) => set('limits', f.limits.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                  <Input disabled={d} className="w-28" placeholder="测量键" value={l.itemKey} onChange={(e) => upd({ itemKey: e.target.value })} />
                  <Input disabled={d} className="w-24" placeholder="名称" value={l.label} onChange={(e) => upd({ label: e.target.value })} />
                  <NativeSelect disabled={d} className="w-32" value={l.mode} onChange={(e) => upd({ mode: e.target.value as Limit['mode'] })}>
                    <option value="RELATIVE_TO_SPEC">相对规格 %</option>
                    <option value="ABSOLUTE">绝对值</option>
                  </NativeSelect>
                  {l.mode === 'RELATIVE_TO_SPEC' ? (
                    <>
                      <NativeSelect disabled={d} className="w-28" value={l.specField} onChange={(e) => upd({ specField: e.target.value })}>
                        <option value="">规格字段</option>
                        {SPEC_FIELDS.map((x) => <option key={x} value={x}>{SPEC_FIELD_LABELS[x]}</option>)}
                      </NativeSelect>
                      <Input disabled={d} className="w-20" placeholder="下限%" value={l.minPct} onChange={(e) => upd({ minPct: e.target.value })} />
                      ~
                      <Input disabled={d} className="w-20" placeholder="上限%" value={l.maxPct} onChange={(e) => upd({ maxPct: e.target.value })} />
                    </>
                  ) : (
                    <>
                      <Input disabled={d} className="w-20" placeholder="最小" value={l.min} onChange={(e) => upd({ min: e.target.value })} />
                      ~
                      <Input disabled={d} className="w-20" placeholder="最大" value={l.max} onChange={(e) => upd({ max: e.target.value })} />
                    </>
                  )}
                  <NativeSelect disabled={d} className="w-28" value={l.aggregate} onChange={(e) => upd({ aggregate: e.target.value as Limit['aggregate'] })}>
                    <option value="EACH">每个读数</option>
                    <option value="AVG">平均值</option>
                  </NativeSelect>
                  <label className="flex items-center gap-1 text-xs"><Checkbox disabled={d} checked={l.required} onChange={(e) => upd({ required: e.target.checked })} />必测</label>
                  {!d && <Button variant="ghost" size="icon" onClick={() => set('limits', f.limits.filter((_, j) => j !== i))}><Trash2 /></Button>}
                </div>
              );
            })}
          </Section>
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardContent className="space-y-3 p-5">
            {errors.length > 0 && (
              <div className="rounded bg-red-50 p-3 text-sm text-red-700">{errors.map((e) => <div key={e}>{e}</div>)}</div>
            )}
            <Field label="版本说明"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="如：根据客户 2026 版质量协议调整阈值" /></Field>
            <div className="flex justify-end">
              <Button disabled={errors.length > 0} loading={saving} onClick={() => onSave?.(rules, notes)}>保存草稿</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function StandardDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER');
  const q = useQuery({ queryKey: ['standard', id], queryFn: () => api.get<StandardDetail>(`/standards/${id}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const std = q.data;
  const versions = std?.versions ?? [];
  const draft = versions.find((v) => v.status === 'DRAFT');
  const current = versions.find((v) => v.status === 'PUBLISHED');
  const shown = versions.find((v) => v.id === selected) ?? draft ?? current ?? versions[0];

  const create = useAction(
    () =>
      api.post<Version>(`/standards/${id}/versions`, {
        rules: standardRulesSchema.parse(
          shown?.rules ?? (std?.kind === 'FOUR_POINT' ? DEV_DEFAULT_FOUR_POINT_RULES : { schemaVersion: 1 }),
        ),
        notes: shown ? `基于 v${shown.version}` : '初始版本',
      }),
    { success: '已创建草稿版本', invalidate: [['standard', id], ['standards']], onSuccess: (v) => setSelected(v.id) },
  );
  const save = useAction(
    ({ rules, notes }: { rules: StandardRulesInput; notes: string }) => api.put(`/standards/versions/${draft!.id}`, { rules, notes: notes || null }),
    { success: '草稿已保存', invalidate: [['standard', id]] },
  );
  const publish = useAction((vid: string) => api.post(`/standards/versions/${vid}/publish`), {
    success: '已发布，新开始的检验将使用该版本',
    invalidate: [['standard', id], ['standards']],
  });

  return (
    <>
      <PageHeader
        title={std?.name ?? '质量标准'}
        description={std ? `${std.kind === 'FOUR_POINT' ? '四分制标准' : `客户标准 · ${std.customer?.name ?? ''}`} · ${std.code}` : undefined}
        actions={<Button variant="outline" asChild><Link to="/standards"><ArrowLeft /> 返回</Link></Button>}
      />
      <QueryState q={q}>
        {std && (
          <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
            <Card className="h-fit">
              <CardHeader><CardTitle>版本</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelected(v.id)}
                    className={cn('w-full rounded-md border px-3 py-2 text-left text-sm', shown?.id === v.id ? 'border-primary bg-accent' : 'hover:bg-secondary')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">v{v.version}</span>
                      <Badge variant={v.status === 'PUBLISHED' ? 'success' : v.status === 'DRAFT' ? 'warning' : 'outline'}>
                        {v.status === 'PUBLISHED' ? '生效中' : v.status === 'DRAFT' ? '草稿' : '已停用'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{fmtDate(v.publishedAt ?? v.createdAt)}</div>
                    {v.isDevDefault && <div className="mt-1"><DevDefaultBadge /></div>}
                  </button>
                ))}
                {editable && !draft && (
                  <Button className="mt-2 w-full" variant="outline" loading={create.isPending} onClick={() => create.mutate(undefined)}>
                    <Plus /> 基于当前版本新建
                  </Button>
                )}
              </CardContent>
            </Card>
            <div className="space-y-3">
              {std.description && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{std.description}</p>}
              {shown?.isDevDefault && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  该版本为开发默认值，未经工厂批准，不能作为正式验收依据。请由质量负责人确认数值后新建正式版本并发布。
                </p>
              )}
              {shown ? (
                <>
                  {shown.status === 'DRAFT' && editable && (
                    <div className="flex justify-end">
                      <ConfirmButton
                        variant="default"
                        size="default"
                        title={`发布 v${shown.version}？`}
                        description="发布后规则不可修改；之后开始的检验将使用该版本，已开始的检验仍使用原快照。"
                        onConfirm={() => publish.mutateAsync(shown.id)}
                      >
                        发布此版本
                      </ConfirmButton>
                    </div>
                  )}
                  <RulesEditor
                    key={shown.id + (shown.status === 'DRAFT' ? JSON.stringify(shown.rules) : '')}
                    initial={shown.rules}
                    kind={std.kind}
                    readOnly={!(editable && shown.status === 'DRAFT')}
                    saving={save.isPending}
                    onSave={(rules, notes) => save.mutate({ rules, notes })}
                  />
                </>
              ) : (
                <Card><CardContent className="p-6 text-sm text-muted-foreground">还没有版本，请新建版本。</CardContent></Card>
              )}
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
