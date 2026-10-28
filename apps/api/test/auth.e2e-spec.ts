import { adminLogin, api, bindWechat, createTestApp, type TestContext } from './helpers';

describe('认证、微信绑定与权限 (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let deptId: string;
  let inspector: { id: string; employeeNo: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await adminLogin(ctx.app);
    const d = await api(ctx.app, admin).post('/departments', { code: 'AUTH-QC', name: '认证测试质检部' });
    deptId = d.body.id;
    const u = await api(ctx.app, admin).post('/users', {
      employeeNo: 'A-I01',
      name: '质检员甲',
      departmentId: deptId,
      roles: [{ role: 'INSPECTOR' }],
    });
    expect(u.status).toBe(201);
    inspector = u.body;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('未登录访问受保护接口返回 401', async () => {
    const r = await api(ctx.app).get('/users');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('UNAUTHENTICATED');
  });

  it('PC 登录连续失败后锁定账号', async () => {
    await api(ctx.app, admin).post('/users', {
      employeeNo: 'A-LOCK',
      name: '锁定测试',
      roles: [{ role: 'SALES' }],
      username: 'locktest',
      password: 'LockTest12345',
    });
    for (let i = 0; i < 5; i++) {
      const r = await api(ctx.app).post('/auth/admin/login', { username: 'locktest', password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const locked = await api(ctx.app).post('/auth/admin/login', { username: 'locktest', password: 'LockTest12345' });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('员工首次微信绑定：错误次数限制、一次性、不能重复绑定', async () => {
    const gen = await api(ctx.app, admin).post(`/users/${inspector.id}/bind-code`);
    expect(gen.status).toBe(201);
    expect(gen.body.bindCode).toMatch(/^[0-9A-Z]{8}$/);
    // 数据库只存哈希
    const row = await ctx.prisma.wechatBindCode.findFirst({ where: { userId: inspector.id } });
    expect(row?.codeHash).not.toContain(gen.body.bindCode);

    const login = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i01' });
    expect(login.body.status).toBe('UNBOUND');

    const wrong = await api(ctx.app).post('/auth/wechat/bind', {
      bindTicket: login.body.bindTicket,
      employeeNo: 'A-I01',
      bindCode: 'ZZZZZZZZ',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toContain('还可尝试 4 次');

    const ok = await api(ctx.app).post('/auth/wechat/bind', {
      bindTicket: login.body.bindTicket,
      employeeNo: 'A-I01',
      bindCode: gen.body.bindCode,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeTruthy();

    // 同一个绑定码不能再次使用，同一员工也不能被另一个微信绑定
    const other = await api(ctx.app).post('/auth/wechat/login', { code: 'code-someone-else' });
    const reuse = await api(ctx.app).post('/auth/wechat/bind', {
      bindTicket: other.body.bindTicket,
      employeeNo: 'A-I01',
      bindCode: gen.body.bindCode,
    });
    expect(reuse.status).toBe(400);
    const again = await api(ctx.app, admin).post(`/users/${inspector.id}/bind-code`);
    expect(again.status).toBe(409);

    // 以后直接静默登录
    const relogin = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i01' });
    expect(relogin.body.status).toBe('BOUND');
    const me = await api(ctx.app, relogin.body.accessToken).get('/auth/me');
    expect(me.body.employeeNo).toBe('A-I01');
    expect(me.body.clientType).toBe('MINIAPP');
  });

  it('绑定码错误次数达到上限后作废', async () => {
    const u = await api(ctx.app, admin).post('/users', { employeeNo: 'A-I02', name: '质检员乙', roles: [{ role: 'INSPECTOR' }] });
    const gen = await api(ctx.app, admin).post(`/users/${u.body.id}/bind-code`);
    const login = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i02' });
    for (let i = 0; i < 5; i++) {
      await api(ctx.app).post('/auth/wechat/bind', { bindTicket: login.body.bindTicket, employeeNo: 'A-I02', bindCode: 'AAAAAAAA' });
    }
    const late = await api(ctx.app).post('/auth/wechat/bind', {
      bindTicket: login.body.bindTicket,
      employeeNo: 'A-I02',
      bindCode: gen.body.bindCode,
    });
    expect(late.status).toBe(400);
  });

  it('刷新令牌轮换；旧令牌重放会撤销整个会话', async () => {
    const login = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i01' });
    const first = login.body.refreshToken;
    const r1 = await api(ctx.app).post('/auth/refresh', { refreshToken: first });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first);
    const replay = await api(ctx.app).post('/auth/refresh', { refreshToken: first });
    expect(replay.status).toBe(401);
    // 会话已被撤销：新令牌也失效
    const r2 = await api(ctx.app).post('/auth/refresh', { refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
    const me = await api(ctx.app, r1.body.accessToken).get('/auth/me');
    expect(me.status).toBe(401);
  });

  it('管理员强制下线与解绑立即生效', async () => {
    const login = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i01' });
    const token = login.body.accessToken;
    expect((await api(ctx.app, token).get('/auth/me')).status).toBe(200);
    const fl = await api(ctx.app, admin).post(`/users/${inspector.id}/force-logout`);
    expect(fl.body.revoked).toBeGreaterThan(0);
    expect((await api(ctx.app, token).get('/auth/me')).status).toBe(401);

    const unbind = await api(ctx.app, admin).post(`/users/${inspector.id}/unbind-wechat`);
    expect(unbind.status).toBe(200);
    const after = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i01' });
    expect(after.body.status).toBe('UNBOUND');
  });

  it('停用员工立即撤销会话', async () => {
    const u = await api(ctx.app, admin).post('/users', { employeeNo: 'A-I03', name: '质检员丙', roles: [{ role: 'INSPECTOR' }] });
    const t = await bindWechat(ctx.app, admin, u.body.id, 'A-I03', 'a-i03');
    expect((await api(ctx.app, t.accessToken).get('/auth/me')).status).toBe(200);
    const upd = await api(ctx.app, admin).put(`/users/${u.body.id}`, {
      name: '质检员丙',
      roles: [{ role: 'INSPECTOR' }],
      status: 'DISABLED',
    });
    expect(upd.status).toBe(200);
    expect((await api(ctx.app, t.accessToken).get('/auth/me')).status).toBe(401);
    expect((await api(ctx.app).post('/auth/refresh', { refreshToken: t.refreshToken })).status).toBe(401);
  });

  it('角色权限：质检员不能管理员工、业务员不能建任务', async () => {
    const u = await api(ctx.app, admin).post('/users', { employeeNo: 'A-I04', name: '质检员丁', roles: [{ role: 'INSPECTOR' }] });
    const t = await bindWechat(ctx.app, admin, u.body.id, 'A-I04', 'a-i04');
    expect((await api(ctx.app, t.accessToken).get('/users')).status).toBe(403);
    expect((await api(ctx.app, t.accessToken).post('/fabrics', { code: 'X', nameZh: 'X' })).status).toBe(403);
    expect((await api(ctx.app, t.accessToken).get('/reviews/queue')).status).toBe(403);

    await api(ctx.app, admin).post('/users', {
      employeeNo: 'A-S01',
      name: '业务员',
      roles: [{ role: 'SALES' }],
      username: 'sales01',
      password: 'Sales0123456',
    });
    const sales = await adminLogin(ctx.app, 'sales01', 'Sales0123456');
    expect((await api(ctx.app, sales).get('/fabrics')).status).toBe(200);
    expect((await api(ctx.app, sales).post('/tasks', {})).status).toBe(403);
    expect((await api(ctx.app, sales).post('/standards', {})).status).toBe(403);
  });

  it('客户端提交的角色字段不会被采信', async () => {
    const r = await api(ctx.app).post('/auth/wechat/login', { code: 'code-a-i04', role: 'ADMIN', userId: 'x' });
    const me = await api(ctx.app, r.body.accessToken).get('/auth/me');
    expect(me.body.roles).toEqual([{ role: 'INSPECTOR', departmentId: null }]);
  });

  it('审计日志记录关键操作且不包含敏感字段', async () => {
    const logs = await api(ctx.app, admin).get(`/audit-logs?entityType=User&entityId=${inspector.id}`);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['user.create', 'wechat.bind_code.generate', 'wechat.bind', 'wechat.unbind']));
    expect(JSON.stringify(logs.body)).not.toMatch(/passwordHash"\s*:\s*"\$argon/);
  });
});
