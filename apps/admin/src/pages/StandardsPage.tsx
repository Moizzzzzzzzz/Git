import {
  DEFAULT_TEMPLATE_CONTENT,
  DEFECT_SEVERITIES,
  SEVERITY_LABELS,
  SPEC_FIELDS,
  templateContentSchema,
  type DefectSeverity,
  type TemplateContentInput,
} from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DevDefaultBadge, PageHeader, QueryState } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { useCustomers, useStandards } from './FabricsPage';

export interface DefectType {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
  category: string | null;
  defaultSeverity: DefectSeverity;
  sortOrder: number;
  isActive: boolean;
}

export function useDefectTypes() {
  return useQuery({ queryKey: ['defect-types'], queryFn: () => api.get<DefectType[]>('/defect-types') });
}

export const SPEC_FIELD_LABELS: Record<(typeof SPEC_FIELDS)[number], string> = {
  widthCm: '门幅',
  cuttableWidthCm: '可裁门幅',
  gsm: '克重',
  nominalLengthM: '标称长度',
};

export function StandardsPage() {
  return (
    <>
      <PageHeader title="质量标准" description="四分制与客户标准（版本化）、疵点类型、检验模板" />
      <Tabs defaultValue="standards">
        <TabsList>
          <TabsTrigger value="standards">质量标准</TabsTrigger>
          <TabsTrigger value="defects">疵点类型</TabsTrigger>
          <TabsTrigger value="templates">检验模板</TabsTrigger>
        </TabsList>
        <TabsContent value="standards"><StandardsTab /></TabsContent>
        <TabsContent value="defects"><DefectTypesTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
      </Tabs>
    </>
  );
}

function StandardsTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER');
  const list = useStandards();
  const customers = useCustomers();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', name: '', kind: 'CUSTOMER', customerId: '', description: '' });
  const save = useAction(() => api.post('/standards', { ...f, customerId: f.customerId || null }), {
    success: '已创建，请在详情页新建版本并发布',
    invalidate: [['standards']],
    onSuccess: () => setOpen(false),
  });
  return (
    <Card>
      <div className="flex justify-end border-b p-3">
        {editable && <Button onClick={() => setOpen(true)}><Plus /> 新建标准</Button>}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>编码</TH><TH>名称</TH><TH>类型</TH><TH>生效版本</TH><TH>状态</TH><TH /></TR>
          </THead>
          <TBody>
            {list.data?.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium">{s.code}</TD>
                <TD>{s.name}</TD>
                <TD><Badge variant="secondary">{s.kind === 'FOUR_POINT' ? '四分制' : '客户标准'}</Badge></TD>
                <TD>
                  {s.currentVersion ? (
                    <span className="flex items-center gap-1.5">v{s.currentVersion.version}{s.currentVersion.isDevDefault && <DevDefaultBadge />}</span>
                  ) : (
                    <span className="text-amber-700">未发布</span>
                  )}
                </TD>
                <TD><Badge variant={s.isActive ? 'success' : 'outline'}>{s.isActive ? '启用' : '停用'}</Badge></TD>
                <TD className="text-right">
                  <Button asChild size="sm" variant="outline"><Link to={`/standards/${s.id}`}>版本与规则</Link></Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="新建质量标准">
          <div className="grid gap-4">
            <Field label="类型" required>
              <NativeSelect value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="CUSTOMER">客户标准</option>
                <option value="FOUR_POINT">四分制标准</option>
              </NativeSelect>
            </Field>
            <Field label="编码" required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="名称" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            {f.kind === 'CUSTOMER' && (
              <Field label="客户" required>
                <NativeSelect value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}>
                  <option value="">请选择</option>
                  {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="说明"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DefectTypesTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER');
  const list = useDefectTypes();
  const [editing, setEditing] = useState<DefectType | 'new' | null>(null);
  const empty = { code: '', nameZh: '', nameEn: '', category: '', defaultSeverity: 'MINOR' as DefectSeverity, sortOrder: 100, isActive: true };
  const [f, setF] = useState(empty);
  const save = useAction(
    () => (editing && editing !== 'new' ? api.put(`/defect-types/${editing.id}`, f) : api.post('/defect-types', f)),
    { success: '已保存', invalidate: [['defect-types']], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm text-muted-foreground">疵点编码被标准规则和历史记录引用，创建后不可修改；不再使用请停用。</p>
        {editable && <Button onClick={() => { setF(empty); setEditing('new'); }}><Plus /> 新建疵点类型</Button>}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>编码</TH><TH>名称</TH><TH>分类</TH><TH>默认严重度</TH><TH>排序</TH><TH>状态</TH><TH /></TR>
          </THead>
          <TBody>
            {list.data?.map((d) => (
              <TR key={d.id}>
                <TD className="font-mono text-xs">{d.code}</TD>
                <TD>{d.nameZh}{d.nameEn && <span className="ml-2 text-xs text-muted-foreground">{d.nameEn}</span>}</TD>
                <TD>{d.category ?? '-'}</TD>
                <TD>{SEVERITY_LABELS[d.defaultSeverity]}</TD>
                <TD>{d.sortOrder}</TD>
                <TD><Badge variant={d.isActive ? 'success' : 'outline'}>{d.isActive ? '启用' : '停用'}</Badge></TD>
                <TD className="text-right">
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => {
                      setF({ code: d.code, nameZh: d.nameZh, nameEn: d.nameEn ?? '', category: d.category ?? '', defaultSeverity: d.defaultSeverity, sortOrder: d.sortOrder, isActive: d.isActive });
                      setEditing(d);
                    }}><Pencil /></Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </QueryState>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === 'new' ? '新建疵点类型' : '编辑疵点类型'}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="编码" required hint="大写字母、数字、下划线">
              <Input value={f.code} disabled={editing !== 'new'} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="中文名称" required><Input value={f.nameZh} onChange={(e) => setF({ ...f, nameZh: e.target.value })} /></Field>
            <Field label="英文名称"><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
            <Field label="分类"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
            <Field label="默认严重度">
              <NativeSelect value={f.defaultSeverity} onChange={(e) => setF({ ...f, defaultSeverity: e.target.value as DefectSeverity })}>
                {DEFECT_SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="排序"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> 启用
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  content: TemplateContentInput;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

function TemplatesTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER');
  const list = useQuery({ queryKey: ['templates', 'full'], queryFn: () => api.get<TemplateRow[]>('/templates') });
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm text-muted-foreground">修改模板只影响之后开始的检验；进行中的检验使用开始时的模板快照。</p>
        {editable && <Button onClick={() => setEditing('new')}><Plus /> 新建模板</Button>}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>编码</TH><TH>名称</TH><TH>检查项 / 测量 / 拍照点</TH><TH>版本</TH><TH>更新时间</TH><TH /></TR>
          </THead>
          <TBody>
            {list.data?.map((t) => (
              <TR key={t.id}>
                <TD className="font-medium">{t.code}</TD>
                <TD>{t.name}</TD>
                <TD>{t.content.checklist?.length ?? 0} / {t.content.measurements?.length ?? 0} / {t.content.photoCheckpoints?.length ?? 0}</TD>
                <TD>v{t.version}</TD>
                <TD className="text-muted-foreground">{fmtDate(t.updatedAt)}</TD>
                <TD className="text-right">{editable && <Button size="sm" variant="ghost" onClick={() => setEditing(t)}><Pencil /></Button>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </QueryState>
      {editing && <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

type Ck = { key: string; label: string; required?: boolean };
type Ms = { key: string; label: string; unit: string; required?: boolean; minReadings?: number; specField?: (typeof SPEC_FIELDS)[number] };
type Ph = { key: string; label: string; required?: boolean; minPhotos?: number };

function TemplateDialog({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const init = template?.content ?? DEFAULT_TEMPLATE_CONTENT;
  const [meta, setMeta] = useState({ code: template?.code ?? '', name: template?.name ?? '', description: template?.description ?? '', isActive: template?.isActive ?? true });
  const [checklist, setChecklist] = useState<Ck[]>(init.checklist ?? []);
  const [measurements, setMeasurements] = useState<Ms[]>(init.measurements ?? []);
  const [photos, setPhotos] = useState<Ph[]>(init.photoCheckpoints ?? []);
  const [error, setError] = useState('');
  const save = useAction(
    () => {
      const content = { checklist, measurements, photoCheckpoints: photos };
      const r = templateContentSchema.safeParse(content);
      if (!r.success) {
        const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；');
        setError(msg);
        return Promise.reject(new Error(msg));
      }
      setError('');
      const body = { ...meta, content: r.data };
      return template ? api.put(`/templates/${template.id}`, body) : api.post('/templates', body);
    },
    { success: '模板已保存', invalidate: [['templates']], onSuccess: onClose },
  );
  const upd = <T,>(arr: T[], set: (v: T[]) => void, i: number, patch: Partial<T>) => set(arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const del = <T,>(arr: T[], set: (v: T[]) => void, i: number) => set(arr.filter((_, j) => j !== i));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={template ? `编辑模板 · ${template.name}` : '新建检验模板'} wide>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="编码" required><Input value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value })} /></Field>
          <Field label="名称" required className="md:col-span-2"><Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          键名使用小写字母/数字/下划线。系统识别的测量键：width（门幅）、effective_width（有效门幅，用于面积计算）、gsm（克重）、roll_length（卷长，全检覆盖校验）。
        </p>

        <Section title="目视检查项" onAdd={() => setChecklist([...checklist, { key: '', label: '', required: true }])}>
          {checklist.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] items-center gap-2">
              <Input placeholder="键名" value={c.key} onChange={(e) => upd(checklist, setChecklist, i, { key: e.target.value })} />
              <Input placeholder="名称" value={c.label} onChange={(e) => upd(checklist, setChecklist, i, { label: e.target.value })} />
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={c.required ?? true} onChange={(e) => upd(checklist, setChecklist, i, { required: e.target.checked })} />必填</label>
              <Button variant="ghost" size="icon" onClick={() => del(checklist, setChecklist, i)}><Trash2 /></Button>
            </div>
          ))}
        </Section>

        <Section title="测量项目" onAdd={() => setMeasurements([...measurements, { key: '', label: '', unit: '', required: true, minReadings: 1 }])}>
          {measurements.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_0.6fr_0.7fr_1fr_auto_auto] items-center gap-2">
              <Input placeholder="键名" value={m.key} onChange={(e) => upd(measurements, setMeasurements, i, { key: e.target.value })} />
              <Input placeholder="名称" value={m.label} onChange={(e) => upd(measurements, setMeasurements, i, { label: e.target.value })} />
              <Input placeholder="单位" value={m.unit} onChange={(e) => upd(measurements, setMeasurements, i, { unit: e.target.value })} />
              <Input type="number" min={1} title="最少读数" value={m.minReadings ?? 1} onChange={(e) => upd(measurements, setMeasurements, i, { minReadings: Number(e.target.value) })} />
              <NativeSelect value={m.specField ?? ''} onChange={(e) => upd(measurements, setMeasurements, i, { specField: (e.target.value || undefined) as Ms['specField'] })}>
                <option value="">对照规格：无</option>
                {SPEC_FIELDS.map((s) => <option key={s} value={s}>对照 {SPEC_FIELD_LABELS[s]}</option>)}
              </NativeSelect>
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={m.required ?? true} onChange={(e) => upd(measurements, setMeasurements, i, { required: e.target.checked })} />必填</label>
              <Button variant="ghost" size="icon" onClick={() => del(measurements, setMeasurements, i)}><Trash2 /></Button>
            </div>
          ))}
        </Section>

        <Section title="拍照检查点" onAdd={() => setPhotos([...photos, { key: '', label: '', required: true, minPhotos: 1 }])}>
          {photos.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_0.7fr_auto_auto] items-center gap-2">
              <Input placeholder="键名" value={p.key} onChange={(e) => upd(photos, setPhotos, i, { key: e.target.value })} />
              <Input placeholder="名称" value={p.label} onChange={(e) => upd(photos, setPhotos, i, { label: e.target.value })} />
              <Input type="number" min={1} title="最少张数" value={p.minPhotos ?? 1} onChange={(e) => upd(photos, setPhotos, i, { minPhotos: Number(e.target.value) })} />
              <label className="flex items-center gap-1 text-xs"><Checkbox checked={p.required ?? true} onChange={(e) => upd(photos, setPhotos, i, { required: e.target.checked })} />必拍</label>
              <Button variant="ghost" size="icon" onClick={() => del(photos, setPhotos, i)}><Trash2 /></Button>
            </div>
          ))}
        </Section>
        {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">{title}</div>
        {onAdd && <Button size="sm" variant="outline" onClick={onAdd}><Plus /> 添加</Button>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
