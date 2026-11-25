// Jest runs TypeScript in-process; worker_threads require the actual compiled JS worker.
jest.mock('../src/vcans-orders/vcans-import-worker', () => jest.requireActual('../dist/vcans-orders/vcans-import-worker'));
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { adminLogin, api, bindWechat, createTestApp, type TestContext } from './helpers';

/** QA only. Run using a coordinator-approved isolated Jest configuration, never the default globalSetup. */
describe('VCANS order independent acceptance: first-stage negative cases', () => {
  let ctx: TestContext;
  let admin: string;
  let sales: string;
  let manager: string;
  let clerk: string;
  let outsider: string;
  let supervisorId: string;
  let supervisor: string;
  let inspector: string;
  let outsiderInspector: string;
  let inspectorId: string;
  let departmentId: string;
  let otherDepartmentId: string;
  const suffix = randomUUID().slice(0, 8);

  async function verifyIsolatedDatabase() {
    const raw = process.env.DATABASE_URL;
    const expected = process.env.FQC_QA_DATABASE_URL;
    const marker = process.env.FQC_QA_DATABASE_MARKER;
    if (!raw || !expected || raw !== expected || !marker || !/^[a-f0-9]{32,64}$/.test(marker)) throw new Error('Missing QA database allowlist or marker');
    const u = new URL(raw);
    if (u.hostname !== '127.0.0.1' || !/^fqc_vcans_qa_[a-f0-9]+$/.test(u.pathname.slice(1)) || !u.port || u.port === '5432') throw new Error('Refusing non-isolated QA endpoint');
    const p = new PrismaClient({ datasourceUrl: raw });
    try {
      const rows = await p.$queryRaw<Array<{ current_database: string; marker: string }>>`SELECT current_database(), marker FROM fqc_qa_guard.fqc_qa_isolation_marker LIMIT 1`;
      if (rows.length !== 1 || rows[0].current_database !== u.pathname.slice(1) || rows[0].marker !== marker) throw new Error('QA database isolation marker mismatch');
    } finally { await p.$disconnect(); }
  }

  async function employee(admin: string, name: string, dept: string, role: string) {
    const no = `QA-VC-${name}-${suffix}`;
    const created = await api(ctx.app, admin).post('/users', { employeeNo: no, name, departmentId: dept, roles: [{ role, departmentId: dept }] });
    expect(created.status).toBe(201);
    const bound = await bindWechat(ctx.app, admin, created.body.id, no, `${name}-${suffix}`);
    return { id: created.body.id as string, token: bound.accessToken as string };
  }

  beforeAll(async () => {
    await verifyIsolatedDatabase();
    ctx = await createTestApp();
    admin = await adminLogin(ctx.app);
    const a = await api(ctx.app, admin).post('/departments', { code: `QA-VCA-${suffix}`, name: '合成业务A' });
    const b = await api(ctx.app, admin).post('/departments', { code: `QA-VCB-${suffix}`, name: '合成业务B' });
    const q = await api(ctx.app, admin).post('/departments', { code: `QA-VCQ-${suffix}`, name: '合成质检' });
    expect([a.status, b.status, q.status]).toEqual([201, 201, 201]);
    departmentId = a.body.id; otherDepartmentId = b.body.id;
    sales = (await employee(admin, 'SALESA', departmentId, 'SALES')).token;
    manager = (await employee(admin, 'MANAGERA', departmentId, 'BUSINESS_MANAGER')).token;
    clerk = (await employee(admin, 'CLERKA', departmentId, 'BUSINESS_CLERK')).token;
    outsider = (await employee(admin, 'SALESB', otherDepartmentId, 'SALES')).token;
    const supervisorUser = await employee(admin, 'SUP', q.body.id, 'QC_SUPERVISOR');
    supervisorId = supervisorUser.id; supervisor = supervisorUser.token;
    const inspectorUser = await employee(admin, 'INSP', q.body.id, 'INSPECTOR');
    inspector = inspectorUser.token; inspectorId = inspectorUser.id;
    outsiderInspector = (await employee(admin, 'INSPB', otherDepartmentId, 'INSPECTOR')).token;
  });
  afterAll(async () => { if (ctx) await ctx.app.close(); });

  function body() {
    return { hNo: `H-QA-${randomUUID()}`, businessDepartmentId: departmentId, supervisorId,
      plan: { mode: 'FULL' }, lines: [{ customerOrderNo: 'QA-PO-1', productName: '合成测试', quantity: '12', quantityUnit: '米' }] };
  }

  it('rejects invalid plans, empty lines and unknown fields before creating an order', async () => {
    const cases = [
      { ...body(), plan: { mode: 'FIXED_PER_LOT', fixedRolls: 0 } },
      { ...body(), plan: { mode: 'FIXED_PER_LOT', fixedRolls: -1 } },
      { ...body(), plan: { mode: 'PERCENT_PER_LOT', percent: '0' } },
      { ...body(), plan: { mode: 'PERCENT_PER_LOT', percent: '100.0001' } },
      { ...body(), plan: { mode: 'PERCENT_PER_LOT', percent: '12.12345' } },
      { ...body(), lines: [] },
      { ...body(), unexpectedField: 'QA-SENTINEL' },
    ];
    for (const value of cases) expect((await api(ctx.app, sales).post('/orders', value)).status).toBe(400);
  });

  it('rejects creation in an unauthorised business department for all business roles', async () => {
    for (const token of [sales, manager, clerk]) {
      const response = await api(ctx.app, token).post('/orders', { ...body(), businessDepartmentId: otherDepartmentId });
      expect(response.status).toBe(403);
    }
    expect((await api(ctx.app, outsider).post('/orders', body())).status).toBe(403);
  });

  it('does not expose another department\'s order details when its H number conflicts', async () => {
    const secret = `QA-PRIVATE-${randomUUID()}`;
    const order = { ...body(), lines: [{ customerOrderNo: secret, productName: '合成私有明细' }] };
    const created = await api(ctx.app, sales).post('/orders', order);
    expect(created.status).toBe(201);
    const response = await api(ctx.app, outsider).post('/orders', { ...order, businessDepartmentId: otherDepartmentId });
    expect([403, 409]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(JSON.stringify(response.body)).not.toContain('合成私有明细');
    if (created.body.id) expect(JSON.stringify(response.body)).not.toContain(created.body.id);
  });
  it('lets each authorised business role create within its own department and preserves separate customer POs', async () => {
    for (const token of [sales, manager, clerk]) {
      const input = { ...body(), lines: [{ customerOrderNo: 'QA-PO-A', productName: '合成A', quantity: '12', quantityUnit: '米' }, { customerOrderNo: 'QA-PO-B', productName: '合成B', quantity: '5', quantityUnit: '公斤' }] };
      const created = await api(ctx.app, token).post('/orders', input);
      expect(created.status).toBe(201);
      const detail = await api(ctx.app, token).get(`/orders/${created.body.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.lines.map((line: { customerOrderNo: string }) => line.customerOrderNo)).toEqual(['QA-PO-A', 'QA-PO-B']);
      expect(detail.body.lines.map((line: { quantityUnit: string }) => line.quantityUnit)).toEqual(['米', '公斤']);
      const denied = await api(ctx.app, outsider).get(`/orders/${created.body.id}`);
      expect(denied.status).toBe(403);
      expect(JSON.stringify(denied.body)).not.toContain('QA-PO-A');
    }
  });

  it('persists authorised changes to the order line and inspection plan rather than silently dropping them', async () => {
    const created = await api(ctx.app, sales).post('/orders', body());
    expect(created.status).toBe(201);
    const id = created.body.id;
    const before = await api(ctx.app, sales).get(`/orders/${id}`);
    expect(before.status).toBe(200);
    const update = await api(ctx.app, sales).put(`/orders/${id}`, { version: before.body.order.version, plan: { mode: 'FIXED_PER_LOT', fixedRolls: 2 }, lines: [{ id: before.body.lines[0].id, productName: '合成修改后' }] });
    expect(update.status).toBe(200);
    const after = await api(ctx.app, sales).get(`/orders/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.order.planMode).toBe('FIXED_PER_LOT');
    expect(after.body.order.fixedRolls).toBe(2);
    expect(after.body.lines[0].productName).toBe('合成修改后');
  });

  it('allows at most one concurrent update based on the same version', async () => {
    const created = await api(ctx.app, sales).post('/orders', body());
    expect(created.status).toBe(201);
    const id = created.body.id, version = created.body.version;
    const responses = await Promise.all([
      api(ctx.app, sales).put(`/orders/${id}`, { version, dueAt: '2026-12-01T00:00:00Z' }),
      api(ctx.app, manager).put(`/orders/${id}`, { version, dueAt: '2026-12-02T00:00:00Z' }),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const after = await api(ctx.app, sales).get(`/orders/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.order.version).toBe(version + 1);
    expect(['2026-12-01T00:00:00.000Z','2026-12-02T00:00:00.000Z']).toContain(after.body.order.dueAt);
  });

  it('allows only the controlled VCANS path to register a missing-fabric roll and keeps QR identity', async () => {
    const standards = await api(ctx.app, admin).get('/standards?kind=FOUR_POINT');
    const templates = await api(ctx.app, admin).get('/templates');
    expect(standards.status).toBe(200); expect(templates.status).toBe(200);
    const standard = standards.body.find((x: { code: string }) => x.code === 'FOUR_POINT_DEV');
    const template = templates.body.find((x: { code: string }) => x.code === 'DEFAULT');
    expect(standard?.id).toBeTruthy(); expect(template?.id).toBeTruthy();
    const input = { ...body(), fourPointStandardId: standard.id, templateId: template.id, lines: [{ customerOrderNo: 'QA-NOFAB-PO', productName: 'QA无货号布', specification: 'QA规格', color: 'QA蓝', quantity: '5', quantityUnit: '米' }] };
    const created = await api(ctx.app, sales).post('/orders', input); expect(created.status).toBe(201);
    const id = created.body.id;
    const initial = await api(ctx.app, sales).get(`/orders/${id}`); expect(initial.status).toBe(200);
    const lineId = initial.body.lines[0].id;
    const assigned = await api(ctx.app, supervisor).post(`/orders/${id}/assignment`, { assigneeId: inspectorId, version: initial.body.order.version }); expect(assigned.status).toBe(201);
    const lot = await api(ctx.app, inspector).post(`/orders/${id}/lots`, { lineId, dyeLotNo: `QA-DYE-${suffix}`, actualRollCount: 1, version: assigned.body.version }); expect(lot.status).toBe(201);
    const rollInput = { version: lot.body.version, fabricId: null, rolls: [{ rollNo: `QA-NOFAB-${suffix}`, nominalLengthM: '10', nominalWeightKg: '2' }] };
    const denied = await api(ctx.app, outsider).post(`/lots/${lot.body.lot.id}/rolls`, rollInput); expect(denied.status).toBe(403);
    const added = await api(ctx.app, inspector).post(`/lots/${lot.body.lot.id}/rolls`, rollInput); expect(added.status).toBe(201);
    expect(added.body.items).toHaveLength(1);
    const item = added.body.items[0]; expect(item.qrCode).toEqual(expect.any(String));
    const activated = await api(ctx.app, supervisor).post(`/orders/${id}/activate`, { version: added.body.version }); expect(activated.status).toBe(201);
    const scan = await api(ctx.app, inspector).get(`/rolls/by-qr/${item.qrCode}`); expect(scan.status).toBe(200);
    expect(scan.body.roll.id).toBe(item.rollId); expect(scan.body.roll.qrCode).toBe(item.qrCode);
    expect(scan.body.roll.fabricId).toBeNull();
    expect(scan.body.roll.orderLine).toMatchObject({ productName: 'QA无货号布', specification: 'QA规格', color: 'QA蓝' });
    const foreign = await api(ctx.app, outsiderInspector).get(`/rolls/by-qr/${item.qrCode}`); expect(foreign.status).toBe(403);
  });

  it('continues rejecting null fabric in the legacy ordinary roll creation path', async () => {
    const response = await api(ctx.app, supervisor).post('/rolls', { rollNo: `QA-LEGACY-${suffix}`, fabricId: null });
    expect(response.status).toBe(400);
  });

  it('imports synthetic workbook bytes, preserves distinct PO rows, and commits idempotently without leaking the preview', async () => {
    const hNo = `HQA${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const headers = ['公司订单号', '客户订单号', '物料号', '规格', '颜色', '订单量', '单位', '业务员'];
    const sheet = XLSX.utils.aoa_to_sheet([headers, [hNo, 'QA-IMPORT-PO-A', '', 'QA规格', 'QA蓝', 10, '米', 'QA员工'], [hNo, 'QA-IMPORT-PO-B', '', 'QA规格', 'QA灰', 20, '公斤', 'QA员工']]);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'QA合成');
    const fileBase64 = (XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
    const previewRequest = { filename: 'qa-synthetic.xlsx', fileBase64, businessDepartmentId: departmentId, idempotencyKey: randomUUID() };
    const preview = await api(ctx.app, sales).post('/orders/import/preview', previewRequest);
    if (preview.status !== 201) throw new Error(`QA preview HTTP ${preview.status}, code ${preview.body.code}, message ${preview.body.message}`);
    expect(preview.status).toBe(201); expect(preview.body.canImport).toBe(true); expect(preview.body.groups).toHaveLength(1);
    expect(preview.body.groups[0].lines.map((line: { customerOrderNo: string }) => line.customerOrderNo)).toEqual(['QA-IMPORT-PO-A', 'QA-IMPORT-PO-B']);
    const foreign = await api(ctx.app, outsider).post('/orders/import/commit', { previewId: preview.body.previewId, idempotencyKey: randomUUID(), groups: [{ hNo, businessDepartmentId: otherDepartmentId, supervisorId, plan: { mode: 'FULL' } }] });
    expect(foreign.status).toBe(403); expect(JSON.stringify(foreign.body)).not.toContain('QA-IMPORT-PO-A');
    const commitBody = { previewId: preview.body.previewId, idempotencyKey: randomUUID(), groups: [{ hNo, businessDepartmentId: departmentId, supervisorId, plan: { mode: 'FULL' } }] };
    const first = await api(ctx.app, sales).post('/orders/import/commit', commitBody); expect(first.status).toBe(201);
    const replay = await api(ctx.app, sales).post('/orders/import/commit', commitBody); expect(replay.status).toBe(201); expect(replay.body).toEqual(first.body);
    const changed = await api(ctx.app, sales).post('/orders/import/commit', { ...commitBody, groups: [{ ...commitBody.groups[0], plan: { mode: 'FIXED_PER_LOT', fixedRolls: 1 } }] }); expect(changed.status).toBe(409);
    const detail = await api(ctx.app, sales).get(`/orders/${first.body.items[0].id}`); expect(detail.status).toBe(200);
    expect(detail.body.lines.map((line: { customerOrderNo: string }) => line.customerOrderNo)).toEqual(['QA-IMPORT-PO-A', 'QA-IMPORT-PO-B']);
    expect(detail.body.lines.map((line: { productCode: string | null }) => line.productCode)).toEqual([null, null]);
  });

});
