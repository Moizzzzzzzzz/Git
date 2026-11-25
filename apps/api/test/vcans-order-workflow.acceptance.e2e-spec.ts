// Jest runs TypeScript in-process; worker_threads require the actual compiled JS worker.
jest.mock('../src/vcans-orders/vcans-import-worker', () => jest.requireActual('../dist/vcans-orders/vcans-import-worker'));
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { StorageAdapter } from '../src/media/storage.adapter';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { adminLogin, api, bindWechat, createTestApp, putPresigned, type TestContext } from './helpers';

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
  let peerSupervisor: string;
  let globalSupervisor: string;
  let qualityManager: string;
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

  async function employee(admin: string, name: string, dept: string, role: string, roleScope: string | null = dept) {
    const no = `QA-VC-${name}-${suffix}`;
    const created = await api(ctx.app, admin).post('/users', { employeeNo: no, name, departmentId: dept, roles: [{ role, departmentId: roleScope }] });
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
    peerSupervisor = (await employee(admin, 'PEERSUP', q.body.id, 'QC_SUPERVISOR')).token;
    globalSupervisor = (await employee(admin, 'GLOBALSUP', q.body.id, 'QC_SUPERVISOR', null)).token;
    qualityManager = (await employee(admin, 'QM', q.body.id, 'QUALITY_MANAGER')).token;
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

  it('freezes real synthetic photos and a FAIL report while preserving the old PDF after measurement and pending reinspection', async () => {
    const standards = await api(ctx.app, admin).get('/standards?kind=FOUR_POINT'), templates = await api(ctx.app, admin).get('/templates');
    const standard = standards.body.find((x: { code: string }) => x.code === 'FOUR_POINT_DEV');
    const template = templates.body.find((x: { code: string }) => x.code === 'DEFAULT');
    const hNo=`HQA${randomUUID().replace(/-/g,'').toUpperCase()}`;const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['公司订单号','客户订单号','物料号','规格','颜色','订单量','单位','业务员'],[hNo,'QA-FREEZE-PO','','QA缺料规格','QA蓝',50,'米','QA员工']]),'QA合成');const fileBase64=(XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer).toString('base64');
    const preview=await api(ctx.app,sales).post('/orders/import/preview',{filename:'qa-missing-material.xlsx',fileBase64,businessDepartmentId:departmentId,idempotencyKey:randomUUID()});expect(preview.status).toBe(201);expect(preview.body.canImport).toBe(true);
    const committed=await api(ctx.app,sales).post('/orders/import/commit',{previewId:preview.body.previewId,idempotencyKey:randomUUID(),groups:[{hNo,businessDepartmentId:departmentId,supervisorId,fourPointStandardId:standard.id,templateId:template.id,plan:{mode:'FIXED_PER_LOT',fixedRolls:1}}]});expect(committed.status).toBe(201);const id=committed.body.items[0].id;
    const detail = () => api(ctx.app, sales).get(`/orders/${id}`);
    let d = await detail(); const lineId = d.body.lines[0].id;expect(d.body.lines[0].productCode).toBeNull();
    const edited=await api(ctx.app,sales).put(`/orders/${id}`,{version:d.body.order.version,lines:[{id:lineId,productName:'QA缺料品名'}]});expect(edited.status).toBe(200);d=await detail();expect(d.body.lines[0].productName).toBe('QA缺料品名');
    const ass = await api(ctx.app, supervisor).post(`/orders/${id}/assignment`, { assigneeId: inspectorId, version: d.body.order.version }); expect(ass.status).toBe(201);
    const l = await api(ctx.app, inspector).post(`/orders/${id}/lots`, { lineId, dyeLotNo: `QA-FREEZE-${suffix}`, actualRollCount: 1, version: ass.body.version }); expect(l.status).toBe(201); const lotId=l.body.lot.id;
    const rs = await api(ctx.app, inspector).post(`/lots/${lotId}/rolls`, { version:l.body.version, fabricId:null, rolls:[{rollNo:`QA-FREEZE-${suffix}`,nominalLengthM:'50',nominalWeightKg:'10'}] }); expect(rs.status).toBe(201); const roll=rs.body.items[0];
    const [selected,confirmDuringSelection]=await Promise.all([api(ctx.app, inspector).post(`/lots/${lotId}/original-sample-selection`,{version:rs.body.version,orderRollIds:[roll.id]}),api(ctx.app,supervisor).post(`/orders/${id}/confirm`,{version:rs.body.version})]);expect(selected.status).toBe(201);expect(confirmDuringSelection.status).toBe(409);
    const [arrival,confirmDuringArrival]=await Promise.all([api(ctx.app, supervisor).post(`/orders/${id}/arrival-confirmation`,{version:selected.body.version}),api(ctx.app,supervisor).post(`/orders/${id}/confirm`,{version:selected.body.version})]);expect(arrival.status).toBe(201);expect(confirmDuringArrival.status).toBe(409);
    const active=await api(ctx.app, supervisor).post(`/orders/${id}/activate`,{version:arrival.body.version}); expect(active.status).toBe(201);
    const scanned=await api(ctx.app, inspector).get(`/rolls/by-qr/${roll.qrCode}`); expect(scanned.status).toBe(200); const tr=scanned.body.myTasks[0].taskRollId;
    const start=await api(ctx.app, inspector).post('/inspections',{taskRollId:tr,mode:'MANUAL',scope:'FULL'}); expect(start.status).toBe(201);const inspection=start.body.id;
    const jpeg=readFileSync('/PATH/REDACTED'); const photos=[];
    const qaLarge=process.env.FQC_QA_LARGE_PHOTOS==='1';
    const sources=qaLarge?[{key:'roll_label',bytes:readFileSync('/tmp/fqc-qa-large.jpg'),mime:'image/jpeg'},{key:'fabric_face',bytes:readFileSync('/tmp/fqc-qa-photo.webp'),mime:'image/webp'}]:[{key:'roll_label',bytes:jpeg,mime:'image/jpeg'},{key:'fabric_face',bytes:jpeg,mime:'image/jpeg'}];
    if(qaLarge){expect(sources[0].bytes.length).toBeGreaterThan(10*1024*1024);expect(sources[0].bytes.length).toBeLessThan(20*1024*1024);}
    for (const source of sources) { const intent=await api(ctx.app, inspector).post('/media/upload-intents',{inspectionId:inspection,mimeType:source.mime,sizeBytes:source.bytes.length}); expect(intent.status).toBe(201); expect(new URL(intent.body.upload.url).hostname).toBe('127.0.0.1');await putPresigned(intent.body.upload.url,source.mime,source.bytes);expect(new URL(intent.body.thumbUpload.url).hostname).toBe('127.0.0.1');await putPresigned(intent.body.thumbUpload.url,'image/jpeg',jpeg);expect((await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`)).status).toBe(200); photos.push({mediaId:intent.body.mediaId,kind:'CHECKPOINT',checkpointKey:source.key}); }
    const defectId=randomUUID();const defectPhoto=await api(ctx.app, inspector).post('/media/upload-intents',{inspectionId:inspection,mimeType:'image/jpeg',sizeBytes:jpeg.length});expect(defectPhoto.status).toBe(201);for(const upload of [defectPhoto.body.upload,defectPhoto.body.thumbUpload]){expect(new URL(upload.url).hostname).toBe('127.0.0.1');await putPresigned(upload.url,'image/jpeg',jpeg);}expect((await api(ctx.app, inspector).post(`/media/${defectPhoto.body.mediaId}/confirm`)).status).toBe(200);photos.push({mediaId:defectPhoto.body.mediaId,kind:'DEFECT',defectClientId:defectId} as any);
    const inspectionDetail=await api(ctx.app, inspector).get(`/inspections/${inspection}`);expect(inspectionDetail.status).toBe(200);
    const draft=await api(ctx.app, inspector).put(`/inspections/${inspection}/draft`,{baseVersion:inspectionDetail.body.draftVersion,mode:'MANUAL',scope:'FULL',segments:[{startM:0,endM:50}],measurements:[...[1,2,3].map(seq=>({itemKey:'width',seq,value:150})),...[1,2,3].map(seq=>({itemKey:'effective_width',seq,value:145})),{itemKey:'gsm',seq:1,value:180},{itemKey:'roll_length',seq:1,value:50}],checklist:inspectionDetail.body.template.checklist.map((x:{key:string})=>({key:x.key,status:'OK'})),defects:[{clientId:defectId,defectTypeCode:'SLUB',lengthCm:1,positionM:10,severity:'CRITICAL'}],photos}); expect(draft.status).toBe(200);
    d=await detail();const [submitted,confirmDuringSubmit]=await Promise.all([api(ctx.app, inspector).post(`/inspections/${inspection}/submit`,{idempotencyKey:randomUUID(),draftVersion:draft.body.draftVersion}),api(ctx.app,supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version})]);expect(submitted.status).toBe(200);expect(submitted.body.overallResult).toBe('FAIL');expect(confirmDuringSubmit.status).toBe(409);
    if(qaLarge){const revision=await ctx.prisma.inspectionRevision.findUniqueOrThrow({where:{inspectionId_revision:{inspectionId:inspection,revision:submitted.body.revision}}});const frozen=revision.snapshot as unknown as {photos:Array<{checkpointKey:string;objectKey:string}>};const storage=ctx.app.get(StorageAdapter);for(const source of sources){const photo=frozen.photos.find(x=>x.checkpointKey===source.key);expect(photo?.objectKey).toBeTruthy();const bytes=await storage.readBytes(photo!.objectKey,20*1024*1024);expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(source.bytes).digest('hex'));}}

    for (const unauthorized of [peerSupervisor, globalSupervisor]) {
      const hiddenTaskList=await api(ctx.app, unauthorized).get(`/tasks?q=${encodeURIComponent(hNo)}`);expect(hiddenTaskList.status).toBe(200);expect(hiddenTaskList.body.items).toEqual([]);expect(hiddenTaskList.body.total).toBe(0);
      expect((await api(ctx.app, unauthorized).get(`/tasks/${active.body.taskId}`)).status).toBe(403);
      expect((await api(ctx.app, unauthorized).get(`/rolls/by-qr/${roll.qrCode}`)).status).toBe(403);
      expect((await api(ctx.app, unauthorized).post('/rolls/labels',{ids:[roll.rollId]})).status).toBe(403);
      for(const q of ['',roll.rollNo,hNo,'QA']) { const list=await api(ctx.app,unauthorized).get(`/rolls?q=${encodeURIComponent(q)}`);expect(list.status).toBe(200);expect(list.body.items.some((x:{id:string})=>x.id===roll.rollId)).toBe(false); }
      const queue=await api(ctx.app,unauthorized).get('/reviews/queue');expect(queue.status).toBe(200);expect(queue.body.some((x:{id:string})=>x.id===inspection)).toBe(false);
    }
    expect((await api(ctx.app, peerSupervisor).get(`/inspections/${inspection}`)).status).toBe(403);
    for(const unauthorized of [peerSupervisor,globalSupervisor]) expect((await api(ctx.app, unauthorized).post(`/reviews/${inspection}/decide`,{decision:'APPROVE',revision:submitted.body.revision})).status).toBe(403);
    for(const authorized of [supervisor,qualityManager,admin]) { const taskList=await api(ctx.app,authorized).get(`/tasks?q=${encodeURIComponent(hNo)}`);expect(taskList.status).toBe(200);expect(taskList.body.items.some((x:{id:string})=>x.id===active.body.taskId)).toBe(true);expect(taskList.body.total).toBe(1); }
    expect((await api(ctx.app, qualityManager).get(`/inspections/${inspection}`)).status).toBe(200);
    expect((await api(ctx.app, admin).get(`/inspections/${inspection}`)).status).toBe(200);
    d=await detail();const [review,confirmDuringReview]=await Promise.all([api(ctx.app, supervisor).post(`/reviews/${inspection}/decide`,{decision:'APPROVE',revision:submitted.body.revision}),api(ctx.app,supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version})]);expect(review.status).toBe(200);expect(confirmDuringReview.status).toBe(409);
    d=await detail();const confirmations=await Promise.all([api(ctx.app, supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version}),api(ctx.app, supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version})]);expect(confirmations.filter(x=>x.status===201)).toHaveLength(1);expect(confirmations.filter(x=>x.status===409)).toHaveLength(1);const confirmed=confirmations.find(x=>x.status===201)!;const reportVersion=confirmed.body.report.version;
    const oldPdf=await api(ctx.app, sales).get(`/orders/${id}/reports/${reportVersion}/pdf`);expect(oldPdf.status).toBe(200);expect(oldPdf.headers['content-type']).toContain('application/pdf');expect(Buffer.isBuffer(oldPdf.body)).toBe(true);const original=Buffer.from(oldPdf.body);expect(original.subarray(0,5).toString()).toBe('%PDF-');const digest=createHash('sha256').update(original).digest('hex');
    const forbidden=await api(ctx.app, outsider).get(`/orders/${id}/reports/${reportVersion}/pdf`);expect(forbidden.status).toBe(403);
    d=await detail();const measured=await api(ctx.app, inspector).put(`/lots/${lotId}/rolls/${roll.id}/measurements`,{version:d.body.order.version,measuredLengthM:'49.5',measuredWeightKg:'9.750'});expect(measured.status).toBe(200);
    const label=await api(ctx.app, inspector).get(`/rolls/${roll.rollId}/label?purpose=REPRINT`);expect(label.status).toBe(200);expect(label.body.qrCode).toBe(roll.qrCode);expect(Number(label.body.printLengthM)).toBe(49.5);expect(Number(label.body.printWeightKg)).toBe(9.75);
    const initialLabel=await api(ctx.app, inspector).get(`/rolls/${roll.rollId}/label?purpose=INITIAL`);expect(initialLabel.status).toBe(200);expect(initialLabel.body.qrCode).toBe(roll.qrCode);expect(Number(initialLabel.body.printLengthM)).toBe(50);expect(Number(initialLabel.body.printWeightKg)).toBe(10);
    const labelPdf=await api(ctx.app, inspector).get(`/rolls/${roll.rollId}/label.pdf?purpose=REPRINT`);expect(labelPdf.status).toBe(200);expect(Buffer.from(labelPdf.body).subarray(0,5).toString()).toBe('%PDF-');
    expect((await api(ctx.app, outsiderInspector).get(`/rolls/${roll.rollId}/label?purpose=REPRINT`)).status).toBe(403);
    expect((await api(ctx.app, sales).get(`/rolls/${roll.rollId}/label.pdf?purpose=REPRINT`)).status).toBe(403);
    d=await detail();expect((await api(ctx.app, inspector).put(`/lots/${lotId}/rolls/${roll.id}/measurements`,{version:d.body.order.version,measuredWeightKg:'0'})).status).toBe(400);expect((await api(ctx.app, inspector).put(`/lots/${lotId}/rolls/${roll.id}/measurements`,{version:d.body.order.version,measuredWeightKg:'1.2345'})).status).toBe(400);

    d=await detail();const addBody={version:d.body.order.version,requestKey:randomUUID(),orderRollIds:[roll.id],reason:'QA合成复验'};const added=await api(ctx.app, supervisor).post(`/lots/${lotId}/additional-inspections`,addBody);expect(added.status).toBe(201);
    const repeated=await api(ctx.app, supervisor).post(`/lots/${lotId}/additional-inspections`,addBody);expect(repeated.status).toBe(201);expect(repeated.body).toEqual(added.body);
    d=await detail();const pending=await api(ctx.app, supervisor).post(`/lots/${lotId}/additional-inspections`,{version:d.body.order.version,requestKey:randomUUID(),orderRollIds:[roll.id],reason:'QA第二次提前排队'});expect(pending.status).toBe(201);
    const saved=await api(ctx.app, sales).get(`/orders/${id}/reports/${reportVersion}/pdf`);expect(saved.status).toBe(200);expect(createHash('sha256').update(saved.body).digest('hex')).toBe(digest);expect(Buffer.from(saved.body).equals(original)).toBe(true);
    const reopened=await api(ctx.app, supervisor).post(`/inspections/${inspection}/reopen`,{reason:'QA复验'});expect(reopened.status).toBe(200);
    const recheck=await api(ctx.app, inspector).post('/inspections',{taskRollId:tr,mode:'MANUAL',scope:'FULL'});expect(recheck.status).toBe(201);expect(recheck.body.id).not.toBe(inspection);const nextId=recheck.body.id;
    const nextPhotos=[];for(const key of ['roll_label','fabric_face']){const intent=await api(ctx.app, inspector).post('/media/upload-intents',{inspectionId:nextId,mimeType:'image/jpeg',sizeBytes:jpeg.length});expect(intent.status).toBe(201);for(const upload of [intent.body.upload,intent.body.thumbUpload]){expect(new URL(upload.url).hostname).toBe('127.0.0.1');await putPresigned(upload.url,'image/jpeg',jpeg);}expect((await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`)).status).toBe(200);nextPhotos.push({mediaId:intent.body.mediaId,kind:'CHECKPOINT',checkpointKey:key});}
    const nextDetail=await api(ctx.app, inspector).get(`/inspections/${nextId}`);expect(nextDetail.status).toBe(200);
    const passDraft=await api(ctx.app, inspector).put(`/inspections/${nextId}/draft`,{baseVersion:nextDetail.body.draftVersion,mode:'MANUAL',scope:'FULL',segments:[{startM:0,endM:50}],measurements:[...[1,2,3].map(seq=>({itemKey:'width',seq,value:150})),...[1,2,3].map(seq=>({itemKey:'effective_width',seq,value:145})),{itemKey:'gsm',seq:1,value:180},{itemKey:'roll_length',seq:1,value:50}],checklist:nextDetail.body.template.checklist.map((x:{key:string})=>({key:x.key,status:'OK'})),defects:[],photos:nextPhotos});expect(passDraft.status).toBe(200);
    const passSubmit=await api(ctx.app, inspector).post(`/inspections/${nextId}/submit`,{idempotencyKey:randomUUID(),draftVersion:passDraft.body.draftVersion});expect(passSubmit.status).toBe(200);expect(passSubmit.body.overallResult).toBe('PASS');
    expect((await api(ctx.app, supervisor).post(`/reviews/${nextId}/decide`,{decision:'APPROVE',revision:passSubmit.body.revision})).status).toBe(200);
    d=await detail();const reconfirm=await api(ctx.app, supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version});expect(reconfirm.status).toBe(201);expect(reconfirm.body.report.version).toBeGreaterThan(reportVersion);
    const snapshot=await ctx.prisma.vcansReportVersion.findUniqueOrThrow({where:{orderId_version:{orderId:id,version:reconfirm.body.report.version}}});
    const snap=snapshot.snapshot as unknown as { rolls: Array<{id:string;result:string;basisHistory:{inspectionId:string;result:string};additionalHistory:Array<{inspectionId:string|null;status:string;result:string}>;pendingAdditional:boolean}> };
    const frozen=snap.rolls.find(x=>x.id===roll.id)!;expect(frozen.result).toBe('FAIL');expect(frozen.basisHistory).toMatchObject({inspectionId:inspection,result:'FAIL'});expect(frozen.additionalHistory).toEqual(expect.arrayContaining([expect.objectContaining({inspectionId:nextId,status:'APPROVED',result:'PASS'}),expect.objectContaining({inspectionId:null,status:'PENDING',result:'INCOMPLETE'})]));expect(frozen.pendingAdditional).toBe(true);
    const newPdf=await api(ctx.app, sales).get(`/orders/${id}/reports/${reconfirm.body.report.version}/pdf`);expect(newPdf.status).toBe(200);expect(Buffer.from(newPdf.body).subarray(0,5).toString()).toBe('%PDF-');expect(Buffer.from(newPdf.body).equals(original)).toBe(false);writeFileSync('/tmp/fqc-qa-caption-regression.pdf',Buffer.from(newPdf.body),{mode:0o600});
    expect((await api(ctx.app,supervisor).post(`/inspections/${nextId}/reopen`,{reason:'QA执行提前排队的第二次复验'})).status).toBe(200);const queued=await api(ctx.app,inspector).post('/inspections',{taskRollId:tr,mode:'MANUAL',scope:'FULL'});expect(queued.status).toBe(201);expect([inspection,nextId]).not.toContain(queued.body.id);
    const queuedId=queued.body.id;const queuedPhotos=[];for(const key of ['roll_label','fabric_face']){const intent=await api(ctx.app,inspector).post('/media/upload-intents',{inspectionId:queuedId,mimeType:'image/jpeg',sizeBytes:jpeg.length});expect(intent.status).toBe(201);for(const upload of [intent.body.upload,intent.body.thumbUpload]){expect(new URL(upload.url).hostname).toBe('127.0.0.1');await putPresigned(upload.url,'image/jpeg',jpeg);}expect((await api(ctx.app,inspector).post(`/media/${intent.body.mediaId}/confirm`)).status).toBe(200);queuedPhotos.push({mediaId:intent.body.mediaId,kind:'CHECKPOINT',checkpointKey:key});}
    const queuedDetail=await api(ctx.app,inspector).get(`/inspections/${queuedId}`);expect(queuedDetail.status).toBe(200);const queuedDraft=await api(ctx.app,inspector).put(`/inspections/${queuedId}/draft`,{baseVersion:queuedDetail.body.draftVersion,mode:'MANUAL',scope:'FULL',segments:[{startM:0,endM:50}],measurements:[...[1,2,3].map(seq=>({itemKey:'width',seq,value:150})),...[1,2,3].map(seq=>({itemKey:'effective_width',seq,value:145})),{itemKey:'gsm',seq:1,value:180},{itemKey:'roll_length',seq:1,value:50}],checklist:queuedDetail.body.template.checklist.map((x:{key:string})=>({key:x.key,status:'OK'})),defects:[],photos:queuedPhotos});expect(queuedDraft.status).toBe(200);
    const queuedSubmit=await api(ctx.app,inspector).post(`/inspections/${queuedId}/submit`,{idempotencyKey:randomUUID(),draftVersion:queuedDraft.body.draftVersion});expect(queuedSubmit.status).toBe(200);expect(queuedSubmit.body.overallResult).toBe('PASS');expect((await api(ctx.app,supervisor).post(`/reviews/${queuedId}/decide`,{decision:'APPROVE',revision:queuedSubmit.body.revision})).status).toBe(200);
    d=await detail();const third=await api(ctx.app,supervisor).post(`/orders/${id}/confirm`,{version:d.body.order.version});expect(third.status).toBe(201);const thirdSnap=await ctx.prisma.vcansReportVersion.findUniqueOrThrow({where:{orderId_version:{orderId:id,version:third.body.report.version}}});const thirdRoll=(thirdSnap.snapshot as unknown as typeof snap).rolls.find(x=>x.id===roll.id)!;expect(thirdRoll.basisHistory).toMatchObject({inspectionId:inspection,result:'FAIL'});expect(thirdRoll.additionalHistory).toEqual(expect.arrayContaining([expect.objectContaining({inspectionId:nextId,result:'PASS'}),expect.objectContaining({inspectionId:queuedId,result:'PASS'})]));expect(thirdRoll.pendingAdditional).toBe(false);const originalAgain=await api(ctx.app,sales).get(`/orders/${id}/reports/${reportVersion}/pdf`);expect(Buffer.from(originalAgain.body).equals(original)).toBe(true);

    const again=await api(ctx.app, sales).get(`/orders/${id}/reports/${reportVersion}/pdf`);expect(again.status).toBe(200);expect(Buffer.from(again.body).equals(original)).toBe(true);

  });

  it('preserves ordinary legacy-task visibility for same-department supervisors, quality manager and admin', async () => {
    const standards=await api(ctx.app,admin).get('/standards?kind=FOUR_POINT'),templates=await api(ctx.app,admin).get('/templates');
    const standard=standards.body.find((x:{code:string})=>x.code==='FOUR_POINT_DEV'),template=templates.body.find((x:{code:string})=>x.code==='DEFAULT');
    const fabric=await api(ctx.app,admin).post('/fabrics',{code:`QA-LEG-F-${suffix}`,nameZh:'QA普通面料',widthCm:150,cuttableWidthCm:145,gsm:180,defaultFourPointStandardId:standard.id,defaultTemplateId:template.id});expect(fabric.status).toBe(201);
    const roll=await api(ctx.app,admin).post('/rolls',{rollNo:`QA-LEG-ROLL-${suffix}`,fabricId:fabric.body.id});expect(roll.status).toBe(201);
    const title=`QA-LEG-TASK-${suffix}`;const task=await api(ctx.app,supervisor).post('/tasks',{title,assigneeId:inspectorId,fourPointStandardId:standard.id,templateId:template.id,rollIds:[roll.body.id]});expect(task.status).toBe(201);
    for(const actor of [supervisor,peerSupervisor,globalSupervisor,qualityManager,admin]){const list=await api(ctx.app,actor).get(`/tasks?q=${encodeURIComponent(title)}`);expect(list.status).toBe(200);expect(list.body.total).toBe(1);expect(list.body.items[0].id).toBe(task.body.id);}
  });

  it('refuses to attach an unactivated H roll to legacy tasks without blocking ordinary rolls', async () => {
    const standards=await api(ctx.app,admin).get('/standards?kind=FOUR_POINT'),templates=await api(ctx.app,admin).get('/templates');
    const standard=standards.body.find((x:{code:string})=>x.code==='FOUR_POINT_DEV'),template=templates.body.find((x:{code:string})=>x.code==='DEFAULT');
    const created=await api(ctx.app,sales).post('/orders',body());expect(created.status).toBe(201);const id=created.body.id;
    const d=await api(ctx.app,sales).get(`/orders/${id}`),ass=await api(ctx.app,supervisor).post(`/orders/${id}/assignment`,{version:d.body.order.version,assigneeId:inspectorId});expect(ass.status).toBe(201);
    const lot=await api(ctx.app,inspector).post(`/orders/${id}/lots`,{lineId:d.body.lines[0].id,dyeLotNo:`QA-ATTACH-${suffix}`,actualRollCount:1,version:ass.body.version});expect(lot.status).toBe(201);
    const registration=await api(ctx.app,inspector).post(`/lots/${lot.body.lot.id}/rolls`,{version:lot.body.version,fabricId:null,rolls:[{rollNo:`QA-H-ATTACH-${suffix}`}]});expect(registration.status).toBe(201);const hRoll=registration.body.items[0].rollId;
    const taskBody={title:`QA-ATTACH-${suffix}`,assigneeId:inspectorId,fourPointStandardId:standard.id,templateId:template.id};
    const hijack=await api(ctx.app,supervisor).post('/tasks',{...taskBody,rollIds:[hRoll]});expect([400,403,409]).toContain(hijack.status);
    const fabric=await api(ctx.app,admin).post('/fabrics',{code:`QA-ATTACH-F-${suffix}`,nameZh:'QA普通面料',widthCm:150,cuttableWidthCm:145,gsm:180,defaultFourPointStandardId:standard.id,defaultTemplateId:template.id});expect(fabric.status).toBe(201);
    const ordinary=await api(ctx.app,admin).post('/rolls',{rollNo:`QA-ATTACH-ORD-${suffix}`,fabricId:fabric.body.id});expect(ordinary.status).toBe(201);
    const legacy=await api(ctx.app,supervisor).post('/tasks',{...taskBody,rollIds:[ordinary.body.id]});expect(legacy.status).toBe(201);
    const hijackExisting=await api(ctx.app,supervisor).post(`/tasks/${legacy.body.id}/rolls`,{rollIds:[hRoll]});expect([400,403,409]).toContain(hijackExisting.status);
    const latest=await api(ctx.app,inspector).get(`/orders/${id}`);expect(latest.status).toBe(200);expect(latest.body.order.taskId).toBeNull();expect(latest.body.rolls[0].id).toBe(registration.body.items[0].id);
  });

});
