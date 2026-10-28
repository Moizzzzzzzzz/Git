import { ROLL_STATUSES, ROLL_STATUS_LABELS, type RollStatus } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import { FileUp, History, Pencil, Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader, Pager, QueryState, RollStatusBadge, SearchBox } from '@/components/common';
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
import { fmtDate, fmtNum, toNumOrNull } from '@/lib/utils';
import type { Fabric } from './FabricsPage';

export interface RollRow {
  id: string;
  rollNo: string;
  qrCode: string;
  qrContent: string;
  status: RollStatus;
  dyeLotNo: string | null;
  colorCode: string | null;
  nominalLengthM: number | null;
  actualLengthM: number | null;
  notes: string | null;
  createdAt: string;
  fabric: { id: string; code: string; nameZh: string };
  lot: { id: string; lotNo: string; dyeLotNo: string } | null;
}

interface Lot {
  id: string;
  lotNo: string;
  dyeLotNo: string;
  colorCode: string | null;
  producedAt: string | null;
  notes: string | null;
  fabric: { id: string; code: string; nameZh: string };
  fabricId: string;
  _count: { rolls: number };
}

export function useFabricOptions() {
  return useQuery({
    queryKey: ['fabrics', 'options'],
    queryFn: () => api.get<Paged<Fabric>>('/fabrics?pageSize=200').then((r) => r.items),
  });
}

export function RollsPage() {
  return (
    <>
      <PageHeader title="批次与布卷" description="布卷登记、批量导入、二维码标签打印" />
      <Tabs defaultValue="rolls">
        <TabsList>
          <TabsTrigger value="rolls">布卷</TabsTrigger>
          <TabsTrigger value="lots">生产批次 / 缸号</TabsTrigger>
        </TabsList>
        <TabsContent value="rolls">
          <RollsTab />
        </TabsContent>
        <TabsContent value="lots">
          <LotsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function RollsTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [fabricId, setFabricId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RollRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const fabrics = useFabricOptions();
  const list = useQuery({
    queryKey: ['rolls', page, q, status, fabricId],
    queryFn: () => api.get<Paged<RollRow>>(`/rolls${qs({ page, pageSize: 50, q, status, fabricId })}`),
  });
  const items = list.data?.items ?? [];
  const allChecked = items.length > 0 && items.every((r) => selected.has(r.id));
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const printLabels = () => {
    if (!selected.size) return toast.error('请先勾选要打印的布卷');
    if (selected.size > 200) return toast.error('一次最多打印 200 卷');
    window.open(`/print/labels?ids=${[...selected].join(',')}`, '_blank');
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="卷号 / 缸号 / 货号" />
        <NativeSelect className="w-44" value={fabricId} onChange={(e) => { setFabricId(e.target.value); setPage(1); }}>
          <option value="">全部面料</option>
          {fabrics.data?.map((f) => <option key={f.id} value={f.id}>{f.code} {f.nameZh}</option>)}
        </NativeSelect>
        <NativeSelect className="w-32" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          {ROLL_STATUSES.map((s) => <option key={s} value={s}>{ROLL_STATUS_LABELS[s]}</option>)}
        </NativeSelect>
        <div className="flex-1" />
        <Button variant="outline" onClick={printLabels}>
          <Printer /> 打印标签{selected.size ? `（${selected.size}）` : ''}
        </Button>
        {editable && (
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <FileUp /> 批量导入
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> 登记布卷
            </Button>
          </>
        )}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <Checkbox
                  checked={allChecked}
                  onChange={(e) => {
                    const s = new Set(selected);
                    items.forEach((r) => (e.target.checked ? s.add(r.id) : s.delete(r.id)));
                    setSelected(s);
                  }}
                  aria-label="全选"
                />
              </TH>
              <TH>卷号</TH>
              <TH>面料</TH>
              <TH>批号 / 缸号</TH>
              <TH>色号</TH>
              <TH>标称 / 实际 (m)</TH>
              <TH>状态</TH>
              <TH>二维码标识</TH>
              <TH>登记时间</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {items.map((r) => (
              <TR key={r.id}>
                <TD><Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></TD>
                <TD className="font-medium">{r.rollNo}</TD>
                <TD>{r.fabric.code}<div className="text-xs text-muted-foreground">{r.fabric.nameZh}</div></TD>
                <TD>{r.lot?.lotNo ?? '-'} / {r.dyeLotNo ?? '-'}</TD>
                <TD>{r.colorCode ?? '-'}</TD>
                <TD className="tabular-nums">{fmtNum(r.nominalLengthM)} / {fmtNum(r.actualLengthM)}</TD>
                <TD><RollStatusBadge value={r.status} /></TD>
                <TD className="font-mono text-xs">{r.qrCode}</TD>
                <TD className="text-muted-foreground">{fmtDate(r.createdAt, false)}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button asChild size="sm" variant="ghost" title="质检历史">
                      <Link to={`/rolls/${r.id}/history`}><History /></Link>
                    </Button>
                    {editable && (r.status === 'PENDING' || r.status === 'ASSIGNED') && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} title="编辑"><Pencil /></Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={50} total={list.data.total} onChange={setPage} />}
      </QueryState>
      {editing && <RollDialog roll={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </Card>
  );
}

function useLots(fabricId: string) {
  return useQuery({
    queryKey: ['lots', 'byFabric', fabricId],
    queryFn: () => api.get<Paged<Lot>>(`/lots${qs({ fabricId, pageSize: 200 })}`).then((r) => r.items),
    enabled: !!fabricId,
  });
}

function RollDialog({ roll, onClose }: { roll: RollRow | null; onClose: () => void }) {
  const fabrics = useFabricOptions();
  const [f, setF] = useState({
    rollNo: roll?.rollNo ?? '',
    fabricId: roll?.fabric.id ?? '',
    lotId: roll?.lot?.id ?? '',
    dyeLotNo: roll?.dyeLotNo ?? '',
    colorCode: roll?.colorCode ?? '',
    nominalLengthM: roll?.nominalLengthM?.toString() ?? '',
    notes: roll?.notes ?? '',
  });
  const lots = useLots(f.fabricId);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = { ...f, lotId: f.lotId || null, nominalLengthM: toNumOrNull(f.nominalLengthM) };
      if (roll) {
        const { rollNo: _r, ...rest } = body;
        return api.put(`/rolls/${roll.id}`, rest);
      }
      return api.post('/rolls', body);
    },
    { success: '已保存', invalidate: [['rolls']], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={roll ? `编辑布卷 · ${roll.rollNo}` : '登记布卷'} description="保存后系统自动生成唯一二维码标识">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }} className="grid gap-4 md:grid-cols-2">
          <Field label="卷号" required><Input value={f.rollNo} onChange={set('rollNo')} disabled={!!roll} required /></Field>
          <Field label="面料" required>
            <NativeSelect value={f.fabricId} onChange={(e) => setF({ ...f, fabricId: e.target.value, lotId: '' })} required>
              <option value="">请选择</option>
              {fabrics.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.nameZh}</option>)}
            </NativeSelect>
          </Field>
          <Field label="生产批次">
            <NativeSelect value={f.lotId} onChange={set('lotId')} disabled={!f.fabricId}>
              <option value="">无</option>
              {lots.data?.map((l) => <option key={l.id} value={l.id}>{l.lotNo}{l.dyeLotNo ? ` / 缸 ${l.dyeLotNo}` : ''}</option>)}
            </NativeSelect>
          </Field>
          <Field label="缸号"><Input value={f.dyeLotNo} onChange={set('dyeLotNo')} placeholder="默认取批次缸号" /></Field>
          <Field label="色号"><Input value={f.colorCode} onChange={set('colorCode')} /></Field>
          <Field label="标称长度 (m)"><Input inputMode="decimal" value={f.nominalLengthM} onChange={set('nominalLengthM')} /></Field>
          <Field label="备注" className="md:col-span-2"><Textarea value={f.notes} onChange={set('notes')} /></Field>
          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" loading={save.isPending}>保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const CSV_HEADERS: Record<string, string> = {
  卷号: 'rollNo',
  面料货号: 'fabricCode',
  生产批号: 'lotNo',
  缸号: 'dyeLotNo',
  色号: 'colorCode',
  标称长度: 'nominalLengthM',
  备注: 'notes',
};

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [createdIds, setCreatedIds] = useState<string[] | null>(null);
  const run = useAction(
    () =>
      api.post<{ created: number; lotsCreated: number; rollIds: string[] }>('/rolls/import', {
        createMissingLots: true,
        rows: rows.map((r) => ({
          rollNo: r.rollNo,
          fabricCode: r.fabricCode,
          lotNo: r.lotNo || null,
          dyeLotNo: r.dyeLotNo || null,
          colorCode: r.colorCode || null,
          nominalLengthM: r.nominalLengthM ? Number(r.nominalLengthM) : null,
          notes: r.notes || null,
        })),
      }),
    {
      invalidate: [['rolls'], ['lots']],
      onSuccess: (r) => {
        toast.success(`已导入 ${r.created} 卷，新建批次 ${r.lotsCreated} 个`);
        setCreatedIds(r.rollIds);
      },
    },
  );

  function onFile(file: File) {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => CSV_HEADERS[h.trim()] ?? h.trim(),
      complete: (res) => {
        const data = res.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v ?? '').trim()])));
        if (!data.length) toast.error('文件中没有数据行');
        if (data.length > 2000) toast.error('一次最多导入 2000 卷');
        setRows(data.slice(0, 2000));
      },
      error: (err) => toast.error(`解析失败：${err.message}`),
    });
  }

  const template = '﻿卷号,面料货号,生产批号,缸号,色号,标称长度,备注\nR20261028-001,F001,L2026-10,D01,NV-01,100,\n';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="批量导入布卷" description="CSV 文件（UTF-8），全部校验通过才会写入；不存在的批次会自动创建" wide>
        {createdIds ? (
          <div className="space-y-4">
            <p className="text-sm">导入完成，共 {createdIds.length} 卷。</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>关闭</Button>
              <Button onClick={() => window.open(`/print/labels?ids=${createdIds.slice(0, 200).join(',')}`, '_blank')}>
                <Printer /> 打印这些标签{createdIds.length > 200 ? '（前 200 卷）' : ''}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Input type="file" accept=".csv,text/csv" className="max-w-xs" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <a
                className="text-sm text-primary hover:underline"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
                download="布卷导入模板.csv"
              >
                下载模板
              </a>
              {fileName && <span className="text-sm text-muted-foreground">{fileName}：{rows.length} 行</span>}
            </div>
            {rows.length > 0 && (
              <div className="mt-4 max-h-80 overflow-auto rounded border">
                <Table>
                  <THead>
                    <TR><TH>#</TH><TH>卷号</TH><TH>面料货号</TH><TH>批号</TH><TH>缸号</TH><TH>色号</TH><TH>标称长度</TH></TR>
                  </THead>
                  <TBody>
                    {rows.slice(0, 100).map((r, i) => (
                      <TR key={i}>
                        <TD className="text-muted-foreground">{i + 1}</TD>
                        <TD>{r.rollNo}</TD><TD>{r.fabricCode}</TD><TD>{r.lotNo}</TD><TD>{r.dyeLotNo}</TD><TD>{r.colorCode}</TD><TD>{r.nominalLengthM}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {rows.length > 100 && <p className="p-2 text-xs text-muted-foreground">仅预览前 100 行</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button disabled={!rows.length} loading={run.isPending} onClick={() => run.mutate(undefined)}>
                导入 {rows.length || ''} 卷
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LotsTab() {
  const { can } = useAuth();
  const editable = can('ADMIN', 'QUALITY_MANAGER', 'QC_SUPERVISOR', 'SALES');
  const fabrics = useFabricOptions();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Lot | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['lots', page, q],
    queryFn: () => api.get<Paged<Lot>>(`/lots${qs({ page, pageSize: 20, q })}`),
  });
  const empty = { fabricId: '', lotNo: '', dyeLotNo: '', colorCode: '', producedAt: '', notes: '' };
  const [f, setF] = useState(empty);
  const save = useAction(
    () => {
      const body = { ...f, producedAt: f.producedAt || null };
      return editing && editing !== 'new' ? api.put(`/lots/${editing.id}`, body) : api.post('/lots', body);
    },
    { success: '已保存', invalidate: [['lots']], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      <div className="flex items-center gap-2 border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="批号 / 缸号" />
        <div className="flex-1" />
        {editable && <Button onClick={() => { setF(empty); setEditing('new'); }}><Plus /> 新建批次</Button>}
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>生产批号</TH><TH>缸号</TH><TH>面料</TH><TH>色号</TH><TH>生产日期</TH><TH>布卷数</TH><TH /></TR>
          </THead>
          <TBody>
            {list.data?.items.map((l) => (
              <TR key={l.id}>
                <TD className="font-medium">{l.lotNo}</TD>
                <TD>{l.dyeLotNo || '-'}</TD>
                <TD>{l.fabric.code} {l.fabric.nameZh}</TD>
                <TD>{l.colorCode ?? '-'}</TD>
                <TD>{fmtDate(l.producedAt, false)}</TD>
                <TD>{l._count.rolls}</TD>
                <TD className="text-right">
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => {
                      setF({ fabricId: l.fabricId, lotNo: l.lotNo, dyeLotNo: l.dyeLotNo, colorCode: l.colorCode ?? '', producedAt: l.producedAt?.slice(0, 10) ?? '', notes: l.notes ?? '' });
                      setEditing(l);
                    }}><Pencil /></Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
      </QueryState>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === 'new' ? '新建生产批次' : '编辑生产批次'}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="面料" required className="md:col-span-2">
              <NativeSelect value={f.fabricId} onChange={(e) => setF({ ...f, fabricId: e.target.value })}>
                <option value="">请选择</option>
                {fabrics.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.nameZh}</option>)}
              </NativeSelect>
            </Field>
            <Field label="生产批号" required><Input value={f.lotNo} onChange={(e) => setF({ ...f, lotNo: e.target.value })} /></Field>
            <Field label="缸号"><Input value={f.dyeLotNo} onChange={(e) => setF({ ...f, dyeLotNo: e.target.value })} /></Field>
            <Field label="色号"><Input value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} /></Field>
            <Field label="生产日期"><Input type="date" value={f.producedAt} onChange={(e) => setF({ ...f, producedAt: e.target.value })} /></Field>
            <Field label="备注" className="md:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
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
