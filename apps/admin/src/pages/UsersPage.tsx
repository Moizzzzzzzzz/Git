import { ROLE_CODES, ROLE_LABELS, USER_STATUS_LABELS, type RoleCode, type UserStatus } from '@fabricqc/shared';
import { useQuery } from '@tanstack/react-query';
import { Copy, KeyRound, LogOut, Pencil, Plus, QrCode, Unlink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader, Pager, QueryState, SearchBox } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Checkbox, Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs, type Paged } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

export interface Department {
  id: string;
  code: string;
  name: string;
  _count?: { users: number };
}

interface UserRow {
  id: string;
  employeeNo: string;
  name: string;
  position: string | null;
  phone: string | null;
  status: UserStatus;
  username: string | null;
  hasPassword: boolean;
  department: { id: string; name: string } | null;
  supervisor: { id: string; name: string } | null;
  roles: { role: RoleCode; departmentId: string | null; department: { name: string } | null }[];
  wechatBound: boolean;
  wechatBoundAt: string | null;
  wechatLastLoginAt: string | null;
}

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
}

export function UsersPage() {
  return (
    <>
      <PageHeader title="员工与微信绑定" description="创建员工账号、分配角色、生成一次性微信绑定码" />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">员工</TabsTrigger>
          <TabsTrigger value="departments">部门</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="departments">
          <DepartmentsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function UsersTab() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [bindCode, setBindCode] = useState<{ name: string; employeeNo: string; bindCode: string; expiresAt: string } | null>(null);
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const list = useQuery({
    queryKey: ['users', page, q, role],
    queryFn: () => api.get<Paged<UserRow>>(`/users${qs({ page, pageSize: 20, q, role })}`),
  });
  const genCode = useAction((id: string) => api.post<typeof bindCode>(`/users/${id}/bind-code`), {
    onSuccess: (r) => setBindCode(r),
    invalidate: [['users']],
  });
  const unbind = useAction((id: string) => api.post(`/users/${id}/unbind-wechat`), { success: '已解绑微信并撤销小程序登录', invalidate: [['users']] });
  const forceLogout = useAction((id: string) => api.post<{ revoked: number }>(`/users/${id}/force-logout`), {
    onSuccess: (r) => toast.success(`已强制下线 ${r.revoked} 个会话`),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="姓名 / 员工编号 / 用户名" />
        <NativeSelect className="w-40" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">全部角色</option>
          {ROLE_CODES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        <Button onClick={() => setEditing('new')}>
          <Plus /> 新建员工
        </Button>
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR>
              <TH>员工编号</TH>
              <TH>姓名</TH>
              <TH>部门 / 岗位</TH>
              <TH>角色</TH>
              <TH>状态</TH>
              <TH>微信</TH>
              <TH>PC 账号</TH>
              <TH className="text-right">操作</TH>
            </TR>
          </THead>
          <TBody>
            {list.data?.items.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.employeeNo}</TD>
                <TD>{u.name}</TD>
                <TD className="text-muted-foreground">
                  {u.department?.name ?? '-'} {u.position ? `· ${u.position}` : ''}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={`${r.role}${r.departmentId}`} variant="secondary">
                        {ROLE_LABELS[r.role]}
                        {r.department ? `·${r.department.name}` : ''}
                      </Badge>
                    ))}
                  </div>
                </TD>
                <TD>
                  <Badge variant={u.status === 'ACTIVE' ? 'success' : 'outline'}>{USER_STATUS_LABELS[u.status]}</Badge>
                </TD>
                <TD>
                  {u.wechatBound ? (
                    <Badge variant="success" title={`绑定于 ${fmtDate(u.wechatBoundAt)}，最近登录 ${fmtDate(u.wechatLastLoginAt)}`}>已绑定</Badge>
                  ) : (
                    <Badge variant="outline">未绑定</Badge>
                  )}
                </TD>
                <TD className="text-muted-foreground">{u.username ?? '-'}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)} title="编辑">
                      <Pencil />
                    </Button>
                    {u.wechatBound ? (
                      <ConfirmButton
                        variant="ghost"
                        title={`解绑 ${u.name} 的微信？`}
                        description="解绑后该员工的小程序登录立即失效，需要重新生成绑定码绑定。"
                        onConfirm={() => unbind.mutateAsync(u.id)}
                      >
                        <Unlink />
                      </ConfirmButton>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="生成绑定码"
                        disabled={u.status !== 'ACTIVE'}
                        loading={genCode.isPending && genCode.variables === u.id}
                        onClick={() => genCode.mutate(u.id)}
                      >
                        <QrCode />
                      </Button>
                    )}
                    {u.username && (
                      <Button size="sm" variant="ghost" title="重置密码" onClick={() => setPwdUser(u)}>
                        <KeyRound />
                      </Button>
                    )}
                    <ConfirmButton
                      variant="ghost"
                      title={`强制 ${u.name} 下线？`}
                      description="将撤销该员工在 PC 和小程序上的所有登录会话。"
                      onConfirm={() => forceLogout.mutateAsync(u.id)}
                    >
                      <LogOut />
                    </ConfirmButton>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {list.data && <Pager page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
      </QueryState>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {pwdUser && <PasswordDialog user={pwdUser} onClose={() => setPwdUser(null)} />}
      <Dialog open={!!bindCode} onOpenChange={(o) => !o && setBindCode(null)}>
        {bindCode && (
          <DialogContent title="微信绑定码" description="此绑定码只显示一次，请当面交给员工本人。">
            <div className="rounded-lg bg-accent p-5 text-center">
              <div className="text-sm text-muted-foreground">
                {bindCode.name}（{bindCode.employeeNo}）
              </div>
              <div className="mt-2 font-mono text-4xl font-bold tracking-[0.3em] text-accent-foreground">{bindCode.bindCode}</div>
              <div className="mt-2 text-xs text-muted-foreground">有效期至 {fmtDate(bindCode.expiresAt)} · 仅能使用一次</div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">员工打开小程序，输入员工编号和绑定码即可完成绑定。旧的未使用绑定码已作废。</p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(bindCode.bindCode).then(() => toast.success('已复制'))}
              >
                <Copy /> 复制
              </Button>
              <Button onClick={() => setBindCode(null)}>完成</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

function UserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const depts = useDepartments();
  const supervisors = useQuery({
    queryKey: ['users', 'options', 'all'],
    queryFn: () => api.get<{ id: string; name: string; employeeNo: string }[]>('/users/options'),
  });
  const [f, setF] = useState({
    employeeNo: user?.employeeNo ?? '',
    name: user?.name ?? '',
    departmentId: user?.department?.id ?? '',
    position: user?.position ?? '',
    phone: user?.phone ?? '',
    supervisorId: user?.supervisor?.id ?? '',
    username: user?.username ?? '',
    password: '',
    status: user?.status ?? ('ACTIVE' as UserStatus),
  });
  const [roles, setRoles] = useState<{ role: RoleCode; departmentId: string | null }[]>(
    user?.roles.map((r) => ({ role: r.role, departmentId: r.departmentId })) ?? [{ role: 'INSPECTOR', departmentId: null }],
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => {
      const body = {
        name: f.name,
        departmentId: f.departmentId || null,
        position: f.position,
        phone: f.phone,
        supervisorId: f.supervisorId || null,
        username: f.username || null,
        roles,
      };
      return user
        ? api.put(`/users/${user.id}`, { ...body, status: f.status })
        : api.post('/users', { ...body, employeeNo: f.employeeNo, password: f.password || null });
    },
    { success: user ? '已保存' : '员工已创建', invalidate: [['users']], onSuccess: onClose },
  );

  const toggleRole = (r: RoleCode, on: boolean) =>
    setRoles(on ? [...roles, { role: r, departmentId: null }] : roles.filter((x) => x.role !== r));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={user ? `编辑员工 · ${user.name}` : '新建员工'} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined);
          }}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="员工编号" required>
              <Input value={f.employeeNo} onChange={set('employeeNo')} disabled={!!user} required />
            </Field>
            <Field label="姓名" required>
              <Input value={f.name} onChange={set('name')} required />
            </Field>
            <Field label="部门">
              <NativeSelect value={f.departmentId} onChange={set('departmentId')}>
                <option value="">未设置</option>
                {depts.data?.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="岗位">
              <Input value={f.position} onChange={set('position')} />
            </Field>
            <Field label="手机号">
              <Input value={f.phone} onChange={set('phone')} />
            </Field>
            <Field label="直属主管" hint="用于审核路由">
              <NativeSelect value={f.supervisorId} onChange={set('supervisorId')}>
                <option value="">未设置</option>
                {supervisors.data?.filter((s) => s.id !== user?.id).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}（{s.employeeNo}）</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-sm font-medium">角色</div>
            <div className="grid gap-2 md:grid-cols-2">
              {ROLE_CODES.map((r) => {
                const cur = roles.find((x) => x.role === r);
                return (
                  <div key={r} className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <Checkbox checked={!!cur} onChange={(e) => toggleRole(r, e.target.checked)} />
                      {ROLE_LABELS[r]}
                    </label>
                    {cur && r === 'QC_SUPERVISOR' && (
                      <NativeSelect
                        className="h-8 w-36"
                        value={cur.departmentId ?? ''}
                        onChange={(e) =>
                          setRoles(roles.map((x) => (x.role === r ? { ...x, departmentId: e.target.value || null } : x)))
                        }
                      >
                        <option value="">全厂范围</option>
                        {depts.data?.map((d) => (
                          <option key={d.id} value={d.id}>仅 {d.name}</option>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="PC 登录用户名" hint="只用小程序的员工可留空">
              <Input value={f.username} onChange={set('username')} autoComplete="off" />
            </Field>
            {!user && (
              <Field label="初始密码" hint="至少 10 位，含字母和数字">
                <Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
              </Field>
            )}
            {user && (
              <Field label="账号状态" hint="停用后立即撤销全部登录">
                <NativeSelect value={f.status} onChange={set('status')}>
                  <option value="ACTIVE">启用</option>
                  <option value="DISABLED">停用</option>
                </NativeSelect>
              </Field>
            )}
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

function PasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const save = useAction(() => api.post(`/users/${user.id}/password`, { password }), {
    success: '密码已重置，该员工的 PC 登录已失效',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`重置密码 · ${user.name}`}>
        <Field label="新密码" hint="至少 10 位，含字母和数字">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>重置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsTab() {
  const list = useDepartments();
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [f, setF] = useState({ code: '', name: '' });
  const save = useAction(
    () => (editing && editing !== 'new' ? api.put(`/departments/${editing.id}`, f) : api.post('/departments', f)),
    { success: '已保存', invalidate: [['departments']], onSuccess: () => setEditing(null) },
  );
  return (
    <Card>
      <div className="flex justify-end border-b p-3">
        <Button onClick={() => { setF({ code: '', name: '' }); setEditing('new'); }}>
          <Plus /> 新建部门
        </Button>
      </div>
      <QueryState q={list}>
        <Table>
          <THead>
            <TR><TH>编码</TH><TH>名称</TH><TH>人数</TH><TH className="text-right">操作</TH></TR>
          </THead>
          <TBody>
            {list.data?.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.code}</TD>
                <TD>{d.name}</TD>
                <TD>{d._count?.users ?? 0}</TD>
                <TD className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => { setF({ code: d.code, name: d.name }); setEditing(d); }}>
                    <Pencil />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </QueryState>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing === 'new' ? '新建部门' : '编辑部门'}>
          <div className="space-y-4">
            <Field label="编码" required>
              <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label="名称" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
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
