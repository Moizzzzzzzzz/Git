import { randomUUID } from 'node:crypto';
import { StorageAdapter } from '../src/media/storage.adapter';
import { adminLogin, api, bindWechat, createTestApp, putPresigned, type TestContext } from './helpers';

/** Independent acceptance: run only against the coordinator's isolated test environment. */
describe('业务任务流程独立验收 (e2e)', () => {
  let ctx: TestContext;
  let admin: string;
  let salesA: string;
  let salesB: string;
  let salesA2: string;
  let manager: string;
  let clerk: string;
  let supervisor: string;
  let adminSales: string;
  let otherSupervisor: string;
  let supervisorId: string;
  let inspectorId: string;
  let inspector2Id: string;
  let inspector: string;
  let fabricId: string;
  let departmentA: string;
  let departmentB: string;
  let standardId: string;
  let templateId: string;
  let taskId: string;
  let registeredItems: { taskRollId: string; rollId: string; rollNo: string }[] = [];
  const inspectionIds: string[] = [];
  let firstUploadUrl = '';
  let firstThumbUrl = '';
  let pendingMediaId = '';
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
  const suffix = randomUUID().slice(0, 8);

  async function employee(name: string, departmentId: string, roles: object[]) {
    const employeeNo = `AC-${name}-${suffix}`;
    const r = await api(ctx.app, admin).post('/users', { employeeNo, name, departmentId, roles });
    expect(r.status).toBe(201);
    const binding = await bindWechat(ctx.app, admin, r.body.id, employeeNo, `${name}-${suffix}`);
    return { id: r.body.id as string, token: binding.accessToken };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await adminLogin(ctx.app);
    const a = await api(ctx.app, admin).post('/departments', { code: `AC-A-${suffix}`, name: '验收业务A' });
    const b = await api(ctx.app, admin).post('/departments', { code: `AC-B-${suffix}`, name: '验收业务B' });
    const q = await api(ctx.app, admin).post('/departments', { code: `AC-Q-${suffix}`, name: '验收质检' });
    expect([a.status, b.status, q.status]).toEqual([201, 201, 201]);
    departmentA = a.body.id;
    departmentB = b.body.id;
    const sa = await employee('SA', departmentA, [{ role: 'SALES', departmentId: departmentA }]);
    const sb = await employee('SB', departmentB, [{ role: 'SALES', departmentId: departmentB }]);
    const sa2 = await employee('SA2', departmentA, [{ role: 'SALES', departmentId: departmentA }]);
    const m = await employee('MA', departmentA, [{ role: 'BUSINESS_MANAGER', departmentId: departmentA }]);
    const c = await employee('CA', departmentA, [{ role: 'BUSINESS_CLERK', departmentId: departmentA }]);
    const s = await employee('SUP', q.body.id, [{ role: 'QC_SUPERVISOR', departmentId: q.body.id }, { role: 'SALES', departmentId: departmentA }]);
    const adminDual = await employee('ADM', departmentA, [{ role: 'ADMIN' }, { role: 'SALES', departmentId: departmentA }]);
    const outsider = await employee('SUPB', departmentB, [{ role: 'QC_SUPERVISOR', departmentId: departmentB }]);
    const i = await employee('IN1', q.body.id, [{ role: 'INSPECTOR' }]);
    const i2 = await employee('IN2', q.body.id, [{ role: 'INSPECTOR' }]);
    salesA = sa.token; salesA2 = sa2.token; salesB = sb.token; manager = m.token; clerk = c.token;
    supervisor = s.token; otherSupervisor = outsider.token; adminSales = adminDual.token; supervisorId = s.id; inspectorId = i.id; inspector2Id = i2.id; inspector = i.token;
    const standards = await api(ctx.app, admin).get('/standards?kind=FOUR_POINT');
    const templates = await api(ctx.app, admin).get('/templates');
    standardId = standards.body.find((x: { code: string }) => x.code === 'FOUR_POINT_DEV').id;
    templateId = templates.body.find((x: { code: string }) => x.code === 'DEFAULT').id;
    const fabric = await api(ctx.app, admin).post('/fabrics', {
      code: `AC-F-${suffix}`, nameZh: '验收面料', widthCm: 150, cuttableWidthCm: 150, gsm: 200,
      defaultFourPointStandardId: standardId, defaultTemplateId: templateId,
    });
    expect(fabric.status).toBe(201);
    fabricId = fabric.body.id;
  });

  afterAll(async () => { if (ctx) await ctx.app.close(); });

  function newTask() {
    return { title: `独立验收 ${suffix}`, businessDepartmentId: departmentA, supervisorId, plannedRollCount: 10, fourPointStandardId: standardId, templateId };
  }

  it('本部门业务员、经理及内勤可建单，计划数为正整数且不要求预录卷号', async () => {
    for (const n of [0, -1, 1.5, null]) {
      const invalid = await api(ctx.app, salesA).post('/tasks/business', { ...newTask(), plannedRollCount: n });
      expect(invalid.status).toBe(400);
    }
    expect((await api(ctx.app, salesB).post('/tasks/business', newTask())).status).toBe(403);
    expect((await api(ctx.app, manager).post('/tasks/business', newTask())).status).toBe(201);
    expect((await api(ctx.app, clerk).post('/tasks/business', newTask())).status).toBe(201);
    const created = await api(ctx.app, salesA).post('/tasks/business', newTask());
    expect(created.status).toBe(201);
    expect(created.body.id).toEqual(expect.any(String));
    taskId = created.body.id;
  });

  it('业务列表按部门隔离，未分发只显示安全进度', async () => {
    for (const token of [salesA, manager, clerk]) {
      const response = await api(ctx.app, token).get('/tasks/business');
      expect(response.status).toBe(200);
      const entry = response.body.items.find((x: { id: string }) => x.id === taskId);
      expect(entry).toMatchObject({ id: taskId, planned: 10, registered: 0, inspected: 0, uninspected: 10, assigned: false, delivered: false });
      expect(JSON.stringify(entry)).not.toMatch(/overallResult|objectKey|defects|photos/);
    }
    const other = await api(ctx.app, salesB).get('/tasks/business');
    expect(other.status).toBe(200);
    expect(other.body.items.some((x: { id: string }) => x.id === taskId)).toBe(false);
    for (const token of [manager, clerk, salesB]) {
      const result = await api(ctx.app, token).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId });
      expect(result.status).toBe(403);
    }
  });

  it('管理员创建有部门授权的经理和内勤，后台登录可读取范围并建单', async () => {
    for (const role of ['BUSINESS_MANAGER', 'BUSINESS_CLERK']) {
      const name = role === 'BUSINESS_MANAGER' ? 'PCMA' : 'PCCA';
      const username = `qa-${name}-${suffix}`;
      const password = 'PUBLIC_REDACTED'; // Isolated test account only.
      const missingScope = await api(ctx.app, admin).post('/users', {
        employeeNo: `AC-NO-${name}-${suffix}`, name, departmentId: departmentA,
        roles: [{ role }], username: `${username}-no`, password,
      });
      expect(missingScope.status).toBe(400);
      const created = await api(ctx.app, admin).post('/users', {
        employeeNo: `AC-${name}-${suffix}`, name, departmentId: departmentA,
        roles: [{ role, departmentId: departmentA }], username, password,
      });
      expect(created.status).toBe(201);
      const login = await api(ctx.app).post('/auth/admin/login', { username, password });
      expect(login.status).toBe(200);
      const token = login.body.accessToken as string;
      const me = await api(ctx.app, token).get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.roles).toEqual(expect.arrayContaining([{ role, departmentId: departmentA }]));
      const list = await api(ctx.app, token).get('/tasks/business');
      expect(list.status).toBe(200);
      expect(list.body.items.some((x: { id: string }) => x.id === taskId)).toBe(true);
      expect((await api(ctx.app, token).post('/tasks/business', newTask())).status).toBe(201);
      expect((await api(ctx.app, token).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() })).status).toBe(403);
      expect((await api(ctx.app, token).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId })).status).toBe(403);
    }
  });

  it('指定主管分派单人且可改派，禁止本人兼任', async () => {
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: supervisorId })).status).toBe(400);
    const first = await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId });
    expect(first.status).toBe(201);
    expect(first.body.assigneeId).toBe(inspectorId);
    const changed = await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspector2Id });
    expect(changed.status).toBe(201);
    expect(changed.body.assigneeId).toBe(inspector2Id);
    const list = await api(ctx.app, salesA).get('/tasks/business');
    expect(list.body.items.find((x: { id: string }) => x.id === taskId).assigned).toBe(true);
    const restored = await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId });
    expect(restored.status).toBe(201);
  });

  it('执行人补录六卷且未提交时未验仍为十卷，不能提前确认或催审', async () => {
    const registered = await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, {
      fabricId, rolls: Array.from({ length: 6 }, (_, n) => ({ rollNo: `AC-${suffix}-${n}`, nominalLengthM: 50 })),
    });
    expect(registered.status).toBe(201);
    expect(registered.body.items).toHaveLength(6);
    registeredItems = registered.body.items;
    const duplicate = await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, { fabricId, rolls: [{ rollNo: registeredItems[0].rollNo }] });
    expect(duplicate.status).toBe(409);
    const excess = await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, { fabricId, rolls: Array.from({ length: 5 }, (_, n) => ({ rollNo: `AC-X-${suffix}-${n}` })) });
    expect(excess.status).toBe(409);
    const progress = await api(ctx.app, salesA).get(`/tasks/${taskId}/business-progress`);
    expect(progress.status).toBe(200);
    expect(progress.body).toMatchObject({ planned: 10, registered: 6, inspected: 0, uninspected: 10 });
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {})).status).toBe(409);
    expect((await api(ctx.app, salesA).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() })).status).toBe(409);
    for (const token of [manager, clerk]) {
      expect((await api(ctx.app, token).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() })).status).toBe(403);
    }
    expect((await api(ctx.app, salesB).get(`/tasks/${taskId}/business-progress`)).status).toBe(403);
    expect((await api(ctx.app, salesA).get(`/tasks/${taskId}/delivery`)).status).toBe(409);
  });

  async function submitRoll(roll: { taskRollId: string }, fail = false, injectCopyFailure = false) {
      const started = await api(ctx.app, inspector).post('/inspections', { taskRollId: roll.taskRollId, mode: 'MACHINE', scope: 'FULL' });
      expect(started.status).toBe(201);
      const id = started.body.id as string;
      inspectionIds.push(id);
      const photos: Record<string, string>[] = [];
      for (const checkpointKey of ['roll_label', 'fabric_face']) {
        const intent = await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: id, mimeType: 'image/jpeg', sizeBytes: jpeg.length });
        expect(intent.status).toBe(201);
        if (fail && checkpointKey === 'roll_label') { firstUploadUrl = intent.body.upload.url; firstThumbUrl = intent.body.thumbUpload.url; }
        await putPresigned(intent.body.upload.url, 'image/jpeg', jpeg);
        await putPresigned(intent.body.thumbUpload.url, 'image/jpeg', jpeg.subarray(0, 512));
        expect((await api(ctx.app, inspector).post(`/media/${intent.body.mediaId}/confirm`)).status).toBe(200);
        photos.push({ mediaId: intent.body.mediaId, kind: 'CHECKPOINT', checkpointKey });
      }
      const defectId = randomUUID();
      if (fail) {
        const photo = await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: id, mimeType: 'image/jpeg', sizeBytes: jpeg.length });
        expect(photo.status).toBe(201);
        await putPresigned(photo.body.upload.url, 'image/jpeg', jpeg);
        await putPresigned(photo.body.thumbUpload.url, 'image/jpeg', jpeg.subarray(0, 512));
        expect((await api(ctx.app, inspector).post(`/media/${photo.body.mediaId}/confirm`)).status).toBe(200);
        photos.push({ mediaId: photo.body.mediaId, kind: 'DEFECT', defectClientId: defectId });
        const pending = await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: id, mimeType: 'image/jpeg', sizeBytes: jpeg.length, withThumbnail: false });
        expect(pending.status).toBe(201);
        await putPresigned(pending.body.upload.url, 'image/jpeg', jpeg);
        pendingMediaId = pending.body.mediaId;
      }
      const draft = await api(ctx.app, inspector).put(`/inspections/${id}/draft`, {
        baseVersion: 0, mode: 'MACHINE', scope: 'FULL', segments: [{ startM: 0, endM: 50 }],
        measurements: [...[1, 2, 3].map((seq) => ({ itemKey: 'width', seq, value: 150 })),
          ...[1, 2, 3].map((seq) => ({ itemKey: 'effective_width', seq, value: 150 })),
          { itemKey: 'gsm', seq: 1, value: 200 }, { itemKey: 'roll_length', seq: 1, value: 50 }],
        checklist: ['label_match', 'color_match', 'hand_feel', 'edge_quality'].map((key) => ({ key, status: 'OK' })),
        defects: fail ? [{ clientId: defectId, defectTypeCode: 'SLUB', lengthCm: 1, positionM: 10, severity: 'CRITICAL' }] : [], photos,
      });
      expect(draft.status).toBe(200);
      const idempotencyKey = randomUUID();
      const payload = { idempotencyKey, draftVersion: draft.body.draftVersion };
      if (injectCopyFailure) {
        const storage = ctx.app.get(StorageAdapter);
        const copy = jest.spyOn(storage, 'copy').mockRejectedValue(new Error('isolated copy failure'));
        try {
          const failed = await api(ctx.app, inspector).post(`/inspections/${id}/submit`, payload);
          expect(failed.status).toBeGreaterThanOrEqual(500);
          expect(await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id }, select: { status: true, revision: true } })).toMatchObject({ status: 'DRAFT', revision: 0 });
          expect(await ctx.prisma.inspectionRevision.count({ where: { inspectionId: id } })).toBe(0);
          expect(await ctx.prisma.reviewAssignment.count({ where: { inspectionId: id, status: 'PENDING' } })).toBe(0);
        } finally { copy.mockRestore(); }
      }
      const submitted = await api(ctx.app, inspector).post(`/inspections/${id}/submit`, payload);
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe('SUBMITTED');
      if (injectCopyFailure) {
        const revision = await ctx.prisma.inspectionRevision.findUniqueOrThrow({ where: { inspectionId_revision: { inspectionId: id, revision: 1 } } });
        const snapshot = revision.snapshot as { photos: { objectKey: string; thumbKey?: string | null }[] };
        const storage = ctx.app.get(StorageAdapter);
        for (const p of snapshot.photos) {
          expect((await storage.head(p.objectKey))?.sizeBytes).toBeGreaterThan(0);
          if (p.thumbKey) expect((await storage.head(p.thumbKey))?.sizeBytes).toBeGreaterThan(0);
        }
        const retry = await api(ctx.app, inspector).post(`/inspections/${id}/submit`, payload);
        expect(retry.body).toMatchObject({ revision: 1, replayed: true });
        for (const p of snapshot.photos) expect((await storage.head(p.objectKey))?.sizeBytes).toBeGreaterThan(0);
      }
      if (fail) expect(submitted.body.overallResult).toBe('FAIL');
      return id;
  }

  it('四卷通过真实验布提交后显示总10、已验4、未验6，不足计划不可整单确认', async () => {
    for (const [index, roll] of registeredItems.slice(0, 4).entries()) {
      await submitRoll(roll, index === 0, index === 1);
    }
    const list = await api(ctx.app, salesA).get('/tasks/business');
    expect(list.body.items.find((x: { id: string }) => x.id === taskId)).toMatchObject({ planned: 10, registered: 6, inspected: 4, uninspected: 6, pendingReview: 4 });
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {})).status).toBe(409);
  });

  it('待逐卷审核可催，跨业务员滚动限频且相同请求幂等', async () => {
    const key = randomUUID();
    const first = await api(ctx.app, salesA).post(`/tasks/${taskId}/reminders`, { idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ accepted: true, reminderId: expect.any(String) });
    const retry = await api(ctx.app, salesA).post(`/tasks/${taskId}/reminders`, { idempotencyKey: key });
    expect(retry.body.reminderId).toBe(first.body.reminderId);
    const second = await api(ctx.app, salesA2).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() });
    expect(second.status).toBe(409);
    expect(await ctx.prisma.qcReviewReminder.count({ where: { taskId } })).toBe(1);
    // Fixture clock positioning is confined to the isolated acceptance database.
    await ctx.prisma.qcReviewReminder.update({ where: { id: first.body.reminderId }, data: { createdAt: new Date(Date.now() - 301000) } });
    const concurrent = await Promise.all([salesA, salesA2].map((token) => api(ctx.app, token).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() })));
    expect(concurrent.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(await ctx.prisma.qcReviewReminder.count({ where: { taskId } })).toBe(2);
  });

  it('改派后旧执行人不能确认原上传或新建上传意向', async () => {
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspector2Id })).status).toBe(201);
    expect([403, 409]).toContain((await api(ctx.app, inspector).post(`/media/${pendingMediaId}/confirm`)).status);
    expect([403, 409]).toContain((await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: inspectionIds[0], mimeType: 'image/jpeg', sizeBytes: jpeg.length })).status);
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId })).status).toBe(201);
  });

  it('业务角色不能通过检验详情或布卷历史绕过整单开放', async () => {
    for (const token of [salesA, salesA2, salesB, manager, clerk]) {
      for (const path of [`/inspections/${inspectionIds[0]}`, `/rolls/${registeredItems[0].rollId}/history`, `/rolls/by-no/${encodeURIComponent(registeredItems[0].rollNo)}/history`]) {
        const result = await api(ctx.app, token).get(path);
        expect([403, 404]).toContain(result.status);
        expect(JSON.stringify(result.body)).not.toMatch(/objectKey|normalizedPoints|overallResult|photos/);
      }
    }
  });

  it('未交付时真实照片签发入口不向纯业务人员签发链接', async () => {
    for (const token of [salesA, salesA2, salesB, manager, clerk]) {
      const detail = await api(ctx.app, token).get(`/inspections/${inspectionIds[0]}`);
      expect([403, 404]).toContain(detail.status);
      expect(JSON.stringify(detail.body)).not.toMatch(/https?:|thumbUrl|objectKey|photos/);
      const delivery = await api(ctx.app, token).get(`/tasks/${taskId}/delivery`);
      expect([403, 404, 409]).toContain(delivery.status);
      expect(JSON.stringify(delivery.body)).not.toMatch(/https?:|thumbUrl|objectKey|photos/);
    }
  });

  it('多角色业务接口仍受部门与交付限制，真实主管和管理员岗位仍可工作', async () => {
    const otherTask = await api(ctx.app, salesB).post('/tasks/business', { ...newTask(), businessDepartmentId: departmentB, title: `B-${suffix}` });
    expect(otherTask.status).toBe(201);
    const inspectorSearch = await api(ctx.app, inspector).get(`/tasks?q=${encodeURIComponent(`B-${suffix}`)}`);
    expect(inspectorSearch.status).toBe(200);
    expect(inspectorSearch.body.items.some((x: { id: string }) => x.id === otherTask.body.id)).toBe(false);
    const outSearch = await api(ctx.app, otherSupervisor).get(`/tasks?q=${encodeURIComponent(`独立验收 ${suffix}`)}`);
    expect(outSearch.status).toBe(200);
    expect(outSearch.body.items.some((x: { id: string }) => x.id === taskId)).toBe(false);
    for (const token of [supervisor, adminSales]) {
      const business = await api(ctx.app, token).get('/tasks/business');
      expect(business.status).toBe(200);
      expect(business.body.items.some((x: { id: string }) => x.id === taskId)).toBe(true);
      expect(business.body.items.some((x: { id: string }) => x.id === otherTask.body.id)).toBe(false);
      expect([403, 404]).toContain((await api(ctx.app, token).get(`/tasks/${otherTask.body.id}/business-progress`)).status);
      expect((await api(ctx.app, token).get(`/tasks/${taskId}/delivery`)).status).toBe(409);
    }
    const supervisorDetail = await api(ctx.app, supervisor).get(`/inspections/${inspectionIds[0]}`);
    expect(supervisorDetail.status).toBe(200);
    const adminUsers = await api(ctx.app, adminSales).get('/users');
    expect(adminUsers.status).toBe(200);
    expect((await api(ctx.app, salesA).get('/users')).status).toBe(403);
    expect((await api(ctx.app, supervisor).get(`/rolls/${registeredItems[0].rollId}/history`)).status).toBe(200);
    expect([403, 404]).toContain((await api(ctx.app, otherSupervisor).get(`/rolls/${registeredItems[0].rollId}/history`)).status);
    const dashboard = await api(ctx.app, supervisor).get('/dashboard/summary');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.recent.some((x: { id: string }) => x.id === inspectionIds[0])).toBe(true);
    const outsideDashboard = await api(ctx.app, otherSupervisor).get('/dashboard/summary');
    expect(outsideDashboard.status).toBe(200);
    expect(outsideDashboard.body.recent.some((x: { id: string }) => x.id === inspectionIds[0])).toBe(false);
    expect((await api(ctx.app, salesA).post('/rolls/labels', { ids: [registeredItems[0].rollId] })).status).toBe(403);
    expect((await api(ctx.app, admin).put(`/rolls/${registeredItems[0].rollId}`, { fabricId, nominalLengthM: 60 })).status).toBe(409);
  });

  it('提交后原照片与缩略图上传链接重放不能改变主管看到的冻结照片', async () => {
    const modified = Buffer.alloc(jpeg.length, 9);
    // An expired/rejected original PUT is also safe; a successful overwrite must not affect frozen copies.
    await fetch(firstUploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: modified });
    await fetch(firstThumbUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: modified.subarray(0, 512) });
    const detail = await api(ctx.app, supervisor).get(`/inspections/${inspectionIds[0]}`);
    expect(detail.status).toBe(200);
    const label = detail.body.photos.find((p: { checkpointKey?: string }) => p.checkpointKey === 'roll_label');
    expect(label.url).toEqual(expect.any(String));
    expect(Buffer.from(await (await fetch(label.url)).arrayBuffer())).toEqual(jpeg);
    expect(Buffer.from(await (await fetch(label.thumbUrl)).arrayBuffer())).toEqual(jpeg.subarray(0, 512));
  });

  it('全卷审核后仍可催最终确认；不合格结果可交付且不自动让步', async () => {
    for (const roll of registeredItems.slice(4)) await submitRoll(roll);
    const remaining = await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, {
      fabricId, rolls: Array.from({ length: 4 }, (_, n) => ({ rollNo: `AC-END-${suffix}-${n}`, nominalLengthM: 50 })),
    });
    expect(remaining.status).toBe(201);
    for (const roll of remaining.body.items) await submitRoll(roll);
    expect(inspectionIds).toHaveLength(10);
    for (const id of inspectionIds) {
      const review = await api(ctx.app, supervisor).post(`/reviews/${id}/decide`, { decision: 'APPROVE', revision: 1 });
      expect(review.status).toBe(200);
      if (id === inspectionIds[0]) expect(review.body.isConcession).toBe(false);
    }
    expect((await api(ctx.app, salesA).get(`/tasks/${taskId}/delivery`)).status).toBe(409);
    await ctx.prisma.qcReviewReminder.updateMany({ where: { taskId }, data: { createdAt: new Date(Date.now() - 301000) } });
    const finalReminder = await api(ctx.app, salesA2).post(`/tasks/${taskId}/reminders`, { idempotencyKey: randomUUID() });
    expect(finalReminder.status).toBe(201);
    expect(finalReminder.body.accepted).toBe(true);
    const confirmations = await Promise.all([1, 2].map(() => api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {})));
    expect(confirmations.map((r) => r.status)).toEqual([201, 201]);
    const confirmed = confirmations[0];
    expect(confirmations[1].body.id).toBe(confirmed.body.id);
    expect(confirmations.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    expect(await ctx.prisma.qcTaskDelivery.count({ where: { taskId } })).toBe(1);
    expect(await ctx.prisma.notificationOutbox.count({ where: { dedupeKey: `task-delivered:${confirmed.body.id}` } })).toBe(1);
    expect(await ctx.prisma.notification.count({ where: { entityType: 'QcTask', entityId: taskId, type: 'TASK_DELIVERED' } })).toBe(1);
    const repeated = await api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {});
    expect(repeated.body).toMatchObject({ id: confirmed.body.id, replayed: true });
    for (const token of [salesA, manager, clerk]) {
      const view = await api(ctx.app, token).get(`/tasks/${taskId}/delivery`);
      expect(view.status).toBe(200);
      expect(view.body.items).toHaveLength(10);
      const failed = view.body.items.find((x: { roll: { id: string } }) => x.roll.id === registeredItems[0].rollId);
      expect(failed).toMatchObject({ overallResult: 'FAIL', review: { decision: 'APPROVE', isConcession: false } });
      const label = failed.inspection.photos.find((p: { checkpointKey?: string }) => p.checkpointKey === 'roll_label');
      expect(Buffer.from(await (await fetch(label.url)).arrayBuffer())).toEqual(jpeg);
      expect(Buffer.from(await (await fetch(label.thumbUrl)).arrayBuffer())).toEqual(jpeg.subarray(0, 512));
    }
    expect([403, 404]).toContain((await api(ctx.app, salesB).get(`/tasks/${taskId}/delivery`)).status);
    const reopen = await api(ctx.app, supervisor).post(`/inspections/${inspectionIds[0]}/reopen`, { reason: '测试' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.message).toContain('已交付');
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspector2Id })).status).toBe(409);
  }, 120000);

  it('计划10卷仅登记1卷并审核后不能提前完成，仍能补卷且不开放详情或整单通知', async () => {
    const created = await api(ctx.app, salesA).post('/tasks/business', { ...newTask(), title: `PARTIAL-${suffix}` });
    expect(created.status).toBe(201);
    const partialId = created.body.id as string;
    expect((await api(ctx.app, supervisor).post(`/tasks/${partialId}/assignment`, { assigneeId: inspectorId })).status).toBe(201);
    const first = await api(ctx.app, inspector).post(`/tasks/${partialId}/rolls/register`, {
      fabricId, rolls: [{ rollNo: `AC-PARTIAL-${suffix}-1`, nominalLengthM: 50 }],
    });
    expect(first.status).toBe(201);
    const id = await submitRoll(first.body.items[0]);
    const deliveredBefore = await ctx.prisma.notificationOutbox.count({ where: { eventType: 'TASK_DELIVERED' } });
    const review = await api(ctx.app, supervisor).post(`/reviews/${id}/decide`, { decision: 'APPROVE', revision: 1 });
    expect(review.status).toBe(200);
    const progress = await api(ctx.app, salesA).get(`/tasks/${partialId}/business-progress`);
    expect(progress.status).toBe(200);
    expect(progress.body).toMatchObject({ planned: 10, registered: 1, inspected: 1, uninspected: 9, delivered: false });
    expect((await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: partialId } })).status).not.toBe('COMPLETED');
    expect(await ctx.prisma.qcTaskDelivery.count({ where: { taskId: partialId } })).toBe(0);
    expect(await ctx.prisma.notificationOutbox.count({ where: { eventType: 'TASK_DELIVERED' } })).toBe(deliveredBefore);
    expect((await api(ctx.app, salesA).get(`/tasks/${partialId}/delivery`)).status).toBe(409);
    const second = await api(ctx.app, inspector).post(`/tasks/${partialId}/rolls/register`, {
      fabricId, rolls: [{ rollNo: `AC-PARTIAL-${suffix}-2`, nominalLengthM: 50 }],
    });
    expect(second.status).toBe(201);
    expect(second.body.items).toHaveLength(1);
  }, 120000);

  it('LEGACY 不合格审核仍需让步接收理由且记录让步', async () => {
    const legacy = await api(ctx.app, inspector).post('/tasks/external', {
      title: `LEGACY-${suffix}`, factoryName: '验收外厂', fabricId, reviewerId: supervisorId,
      fourPointStandardId: standardId, templateId,
      rolls: [{ rollNo: `AC-LEGACY-${suffix}`, nominalLengthM: 50 }],
    });
    expect(legacy.status).toBe(201);
    const task = await api(ctx.app, inspector).get(`/tasks/${legacy.body.id}`);
    expect(task.status).toBe(200);
    const id = await submitRoll({ taskRollId: task.body.rolls[0].taskRollId }, true);
    const missing = await api(ctx.app, supervisor).post(`/reviews/${id}/decide`, { decision: 'APPROVE', revision: 1 });
    expect(missing.status).toBe(400);
    const approved = await api(ctx.app, supervisor).post(`/reviews/${id}/decide`, { decision: 'APPROVE', revision: 1, comment: '验收让步理由' });
    expect(approved.status).toBe(200);
    expect(approved.body.isConcession).toBe(true);
    const detail = await api(ctx.app, supervisor).get(`/inspections/${id}`);
    expect(detail.body.overallResult).toBe('FAIL');
  });
});
