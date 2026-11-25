import { randomUUID } from 'node:crypto';
import { adminLogin, api, bindWechat, createTestApp, type TestContext } from './helpers';

const enabled = process.env.VCANS_CODE_TEST_DATABASE_URL;
const run = enabled ? describe : describe.skip;
run('H订单隔离HTTP烟测', () => {
  let ctx: TestContext;
  const suffix = randomUUID().slice(0, 8);
  beforeAll(async () => {
    const u = new URL(enabled!);
    if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port === '5432' || !u.pathname.startsWith('/fqc_vcans_code_') || process.env.DATABASE_URL !== enabled) throw new Error('拒绝非代码岗隔离库');
    ctx = await createTestApp();
  });
  afterAll(async () => { if (ctx) await ctx.app.close(); });
  it('业务经理能按本部门选主管、建H单并查询；未确认报告不可读取', async () => {
    const admin = await adminLogin(ctx.app);
    const department = await api(ctx.app, admin).post('/departments', { code: `HTTP-${suffix}`, name: 'TEST业务部' });
    expect(department.status).toBe(201);
    const qc = await api(ctx.app, admin).post('/departments', { code: `HTTP-Q-${suffix}`, name: 'TEST质检部' });
    expect(qc.status).toBe(201);
    const sup = await api(ctx.app, admin).post('/users', { employeeNo: `HTTP-SUP-${suffix}`, name: 'TEST主管', departmentId: qc.body.id, roles: [{ role: 'QC_SUPERVISOR', departmentId: qc.body.id }] });
    expect(sup.status).toBe(201);
    const number = `HTTP-M-${suffix}`;
    const manager = await api(ctx.app, admin).post('/users', { employeeNo: number, name: 'TEST经理', departmentId: department.body.id, roles: [{ role: 'BUSINESS_MANAGER', departmentId: department.body.id }] });
    expect(manager.status).toBe(201);
    const token = (await bindWechat(ctx.app, admin, manager.body.id, number, `http-${suffix}`)).accessToken;
    expect((await api(ctx.app, token).get('/orders/options')).status).toBe(200);
    const created = await api(ctx.app, token).post('/orders', { hNo: `TEST-HTTP-${suffix}`, businessDepartmentId: department.body.id, supervisorId: sup.body.id, plan: { mode: 'FULL' }, lines: [{ customerOrderNo: 'TEST-PO' }] });
    expect(created.status).toBe(201);
    const list = await api(ctx.app, token).get('/orders?q=test-po');
    expect(list.status).toBe(200);
    expect(list.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    const detail = await api(ctx.app, token).get(`/orders/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rolls).toEqual([]);
    expect((await api(ctx.app, token).get(`/orders/${created.body.id}/reports/1/pdf`)).status).toBe(404);
  });
});
