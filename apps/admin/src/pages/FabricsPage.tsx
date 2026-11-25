import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader, Pager, QueryState, SearchBox } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtNum, toNumOrNull } from '@/lib/utils';

export interface Customer {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}

interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface Fabric {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string | null;
  composition: string | null;
  widthCm: number | null;
  cuttableWidthCm: number | null;
  gsm: number | null;
  weaveStructure: string | null;
  coatingType: string | null;
  color: string | null;
  colorCode: string | null;
  notes: string | null;
  isActive: boolean;
  customer: Ref | null;
  defaultFourPointStandard: Ref | null;
  defaultCustomerStandard: Ref | null;
  defaultTemplate: Ref | null;
}

export interface StandardOption {
  id: string;
  code: string;
  name: string;
  kind: 'FOUR_POINT' | 'CUSTOMER';
  isActive: boolean;
  currentVersion: { id: string; version: number; isDevDefault: boolean } | null;
}

export function useCustomers() {
  return useQuery({ queryKey: ['customers', 'all'], queryFn: () => api.get<Paged<Customer>>('/customers?pageSize=200').then((r) => r.items) });
}
export function useStandards() {
  return useQuery({ queryKey: ['standards'], queryFn: () => api.get<StandardOption[]>('/standards') });
}
export function useTemplates() {
  return useQuery({ queryKey: ['templates'], queryFn: () => api.get<(Ref & { isActive: boolean })[]>('/templates') });
}

export function FabricsPage() {
  return (
    <>
      <PageHeader title="面料与客户" description="面料档案、规格参数及默认质量标准" />
      <Tabs defaultValue="fabrics">
        <TabsList>
          <TabsTrigger value="fabrics">面料档案</TabsTrigger>
          <TabsTrigger value="customers">客户</TabsTrigger>
        </TabsList>
        <TabsContent value="fabrics">
          <FabricsTab />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function FabricsTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Fabric | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['fabrics', page, q],
    queryFn: () => api.get<Paged<Fabric>>(`/fabrics${qs({ page, pageSize: 20, q })}`),
  });
  return (
    <Card>
      <div className="flex items-center gap-2 border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="货号 / 名称" />
        <div className="flex-1" />
        {editable && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> 新建面料
          </Button>
        )}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR>
              <TH>货号</TH>
              <TH>名称</TH>
              <TH>成分</TH>
              <TH>门幅 / 可裁 (cm)</TH>
              <TH>克重</TH>
              <TH>颜色</TH>
              <TH>客户</TH>
              <TH>默认标准</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {list.data?.items.map((f) => (
              <TR key={f.id}>
                <TD className="font-medium">
                  {f.code}
                  {!f.isActive && <Badge variant="outline" className="ml-2">停用</Badge>}
                </TD>
                <TD>
                  {f.nameZh}
                  {f.nameEn && <div className="text-xs text-muted-foreground">{f.nameEn}</div>}
                </TD>
                <TD className="max-w-[180px] truncate text-muted-foreground">{f.composition ?? '-'}</TD>
                <TD className="tabular-nums">
                  {fmtNum(f.widthCm)} / {fmtNum(f.cuttableWidthCm)}
                </TD>
                <TD className="tabular-nums">{fmtNum(f.gsm)}</TD>
                <TD>{[f.color, f.colorCode].filter(Boolean).join(' · ') || '-'}</TD>
                <TD>{f.customer?.name ?? '-'}</TD>
                <TD className="text-xs text-muted-foreground">
                  {f.defaultFourPointStandard?.name ?? '-'}
                  {f.defaultCustomerStandard && <div>{f.defaultCustomerStandard.name}</div>}
                </TD>
                <TD className="text-right">
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>
                      <Pencil />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
      </QueryState>
      {editing && <FabricDialog fabric={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function FabricDialog({ fabric, onClose }: { fabric: Fabric | null; onClose: () => void }) {
  const customers = useCustomers();
  const standards = useStandards();
  const templates = useTemplates();
  const s = (v: string | null | undefined) => v ?? '';
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    code: s(fabric?.code),
    nameZh: s(fabric?.nameZh),
    nameEn: s(fabric?.nameEn),
    composition: s(fabric?.composition),
    widthCm: n(fabric?.widthCm),
    cuttableWidthCm: n(fabric?.cuttableWidthCm),
    gsm: n(fabric?.gsm),
    weaveStructure: s(fabric?.weaveStructure),
    coatingType: s(fabric?.coatingType),
    color: s(fabric?.color),
    colorCode: s(fabric?.colorCode),
    customerId: s(fabric?.customer?.id),
    defaultFourPointStandardId: s(fabric?.defaultFourPointStandard?.id),
    defaultCustomerStandardId: s(fabric?.defaultCustomerStandard?.id),
    defaultTemplateId: s(fabric?.defaultTemplate?.id),
    notes: s(fabric?.notes),
    isActive: fabric?.isActive ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = {
        ...f,
        widthCm: toNumOrNull(f.widthCm),
        cuttableWidthCm: toNumOrNull(f.cuttableWidthCm),
        gsm: toNumOrNull(f.gsm),
        customerId: f.customerId || null,
        defaultFourPointStandardId: f.defaultFourPointStandardId || null,
        defaultCustomerStandardId: f.defaultCustomerStandardId || null,
        defaultTemplateId: f.defaultTemplateId || null,
      };
      return fabric ? api.put(`/fabrics/${fabric.id}`, body) : api.post('/fabrics', body);
    },
    { success: '已保存', invalidate: [['fabrics']], onSuccess: onClose },
  );
  const fp = standards.data?.filter((x) => x.kind === 'FOUR_POINT') ?? [];
  const cs = standards.data?.filter((x) => x.kind === 'CUSTOMER') ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={fabric ? `编辑面料 · ${fabric.code}` : '新建面料'} wide>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="面料货号" required><Input value={f.code} onChange={set('code')} required /></Field>
            <Field label="中文名称" required><Input value={f.nameZh} onChange={set('nameZh')} required /></Field>
            <Field label="英文名称"><Input value={f.nameEn} onChange={set('nameEn')} /></Field>
            <Field label="成分" className="md:col-span-2"><Input value={f.composition} onChange={set('composition')} placeholder="如 100% Polyester" /></Field>
            <Field label="织造结构"><Input value={f.weaveStructure} onChange={set('weaveStructure')} /></Field>
            <Field label="门幅 (cm)"><Input inputMode="decimal" value={f.widthCm} onChange={set('widthCm')} /></Field>
            <Field label="可裁门幅 (cm)" hint="用于四分制面积计算"><Input inputMode="decimal" value={f.cuttableWidthCm} onChange={set('cuttableWidthCm')} /></Field>
            <Field label="克重 GSM (g/m²)"><Input inputMode="decimal" value={f.gsm} onChange={set('gsm')} /></Field>
            <Field label="涂层类型"><Input value={f.coatingType} onChange={set('coatingType')} /></Field>
            <Field label="颜色"><Input value={f.color} onChange={set('color')} /></Field>
            <Field label="色号"><Input value={f.colorCode} onChange={set('colorCode')} /></Field>
            <Field label="客户">
              <NativeSelect value={f.customerId} onChange={set('customerId')}>
                <option value="">无</option>
                {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="默认四分制标准">
              <NativeSelect value={f.defaultFourPointStandardId} onChange={set('defaultFourPointStandardId')}>
                <option value="">无</option>
                {fp.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="默认客户标准">
              <NativeSelect value={f.defaultCustomerStandardId} onChange={set('defaultCustomerStandardId')}>
                <option value="">无</option>
                {cs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="默认检验模板">
              <NativeSelect value={f.defaultTemplateId} onChange={set('defaultTemplateId')}>
                <option value="">无</option>
                {templates.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="备注" className="md:col-span-3"><Textarea value={f.notes} onChange={set('notes')} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> 启用
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" loading={save.isPending}>保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomersTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['customers', page, q],
    queryFn: () => api.get<Paged<Customer>>(`/customers${qs({ page, pageSize: 20, q })}`),
  });
  const empty = { code: '', name: '', contactName: '', contactPhone: '', notes: '', isActive: true };
  const [f, setF] = useState(empty);
  const save = useAction(
    () => (editing && editing !== 'new' ? api.put(`/customers/${editing.id}`, f) : api.post('/customers', f)),
    { success: '已保存', invalidate: [['customers']], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      <div className="flex items-center gap-2 border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="客户编码 / 名称" />
        <div className="flex-1" />
        {editable && (
          <Button onClick={() => { setF(empty); setEditing('new'); }}>
            <Plus /> 新建客户
          </Button>
        )}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>编码</TH><TH>名称</TH><TH>联系人</TH><TH>电话</TH><TH>状态</TH><TH /></TR>
          </THead>
          <TBody>
            {list.data?.items.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.code}</TD>
                <TD>{c.name}</TD>
                <TD>{c.contactName ?? '-'}</TD>
                <TD>{c.contactPhone ?? '-'}</TD>
                <TD><Badge variant={c.isActive ? 'success' : 'outline'}>{c.isActive ? '启用' : '停用'}</Badge></TD>
                <TD className="text-right">
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setF({ code: c.code, name: c.name, contactName: c.contactName ?? '', contactPhone: c.contactPhone ?? '', notes: c.notes ?? '', isActive: c.isActive });
                        setEditing(c);
                      }}
                    >
                      <Pencil />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
      </QueryState>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === 'new' ? '新建客户' : '编辑客户'}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="编码" required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
            <Field label="名称" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="联系人"><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
            <Field label="电话"><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
            <Field label="备注" className="md:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
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
