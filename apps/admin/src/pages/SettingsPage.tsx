import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { PageHeader, Pager, QueryState, SearchBox } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

interface SettingsResp {
  settings: { companyName: string; bindCodeTtlHours: number };
  system: Record<string, string | number | boolean | null>;
}

const SYSTEM_LABELS: Record<string, string> = {
  environment: '运行环境',
  engineVersion: '评分引擎版本',
  wechatConfigured: '微信小程序 AppID/AppSecret',
  wechatAppId: '小程序 AppID',
  reviewRequestTemplateConfigured: '订阅消息：待审核提醒模板',
  reviewResultTemplateConfigured: '订阅消息：审核结果模板',
  storageConfigured: '图片存储',
  storageProvider: '存储类型',
  storageBucket: '存储桶',
  qrBaseUrl: '二维码链接前缀',
  workersEnabled: '异步通知 Worker',
  accessTokenTtlSeconds: '访问令牌有效期（秒）',
  refreshTokenTtlDays: '刷新令牌有效期（天）',
  bindCodeMaxAttempts: '绑定码最大错误次数',
  loginMaxFailures: 'PC 登录失败锁定次数',
  loginLockMinutes: 'PC 登录锁定时长（分钟）',
};

export function SettingsPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="系统设置" description="基础设置、外部服务配置状态、操作审计" />
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">基础设置</TabsTrigger>
          <TabsTrigger value="audit">审计日志</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab editable={can('ADMIN')} /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </>
  );
}

function GeneralTab({ editable }: { editable: boolean }) {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResp>('/settings') });
  const [f, setF] = useState({ companyName: '', bindCodeTtlHours: 24 });
  useEffect(() => {
    if (q.data) setF(q.data.settings);
  }, [q.data]);
  const save = useAction(() => api.put('/settings', f), { success: '设置已保存', invalidate: [['settings']] });
  return (
    <QueryState q={q}>
      {q.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>基础设置</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="公司名称"><Input disabled={!editable} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} /></Field>
              <Field label="微信绑定码有效期（小时）" hint="1–168 小时"><Input disabled={!editable} type="number" min={1} max={168} value={f.bindCodeTtlHours} onChange={(e) => setF({ ...f, bindCodeTtlHours: Number(e.target.value) })} /></Field>
              {editable && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>保存</Button></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>外部服务与安全参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(q.data.system).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{SYSTEM_LABELS[k] ?? k}</span>
                  <span>
                    {typeof v === 'boolean' ? <Badge variant={v ? 'success' : 'warning'}>{v ? '已配置' : '未配置'}</Badge> : (v ?? '-')}
                  </span>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">密钥类配置只能在服务器环境变量中修改（见 .env.example），后台不显示也不保存任何密钥。</p>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  createdAt: string;
  actor: { name: string; employeeNo: string } | null;
  before: unknown;
  after: unknown;
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['audit', page, q], queryFn: () => api.get<Paged<AuditRow>>(`/audit-logs${qs({ page, pageSize: 30, q })}`) });
  return (
    <Card>
      <div className="border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="按操作筛选，如 review / user" />
      </div>
      <QueryState q={list}>
        <Table>
          <THead><TR><TH>时间</TH><TH>操作人</TH><TH>操作</TH><TH>对象</TH><TH>IP</TH><TH /></TR></THead>
          <TBody>
            {list.data?.items.map((a) => (
              <Fragment key={a.id}>
                <TR>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(a.createdAt)}</TD>
                  <TD>{a.actor ? `${a.actor.name}（${a.actor.employeeNo}）` : '系统 / 匿名'}</TD>
                  <TD className="font-mono text-xs">{a.action}</TD>
                  <TD className="text-xs">{a.entityType} <span className="text-muted-foreground">{a.entityId?.slice(0, 8)}</span></TD>
                  <TD className="text-xs text-muted-foreground">{a.ip ?? '-'}</TD>
                  <TD className="text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? '收起' : '详情'}</Button></TD>
                </TR>
                {open === a.id && (
                  <TR>
                    <TD colSpan={6}>
                      <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify({ before: a.before, after: a.after }, null, 2)}</pre>
                    </TD>
                  </TR>
                )}
              </Fragment>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={30} total={list.data.total} onChange={setPage} />}
      </QueryState>
    </Card>
  );
}
