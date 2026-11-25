import { DeliveryService } from '../src/notifications/delivery.service';
import { api, adminLogin, bindWechat, createTestApp, type TestContext } from './helpers';

describe('业务任务建单权限', () => {
  let ctx: TestContext;
  let admin: string;
  let salesperson: string;
  let businessDepartmentId: string;
  let otherDepartmentId: string;
  let supervisorId: string;
  let supervisor: string;
  let inspectorId: string;
  let inspector: string;
  let fabricId: string;
  let taskId: string;
  let standardId: string;
  let templateId: string;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await adminLogin(ctx.app);
    businessDepartmentId = (await api(ctx.app, admin).post('/departments', { code: 'BUS-A', name: '业务A' })).body.id;
    otherDepartmentId = (await api(ctx.app, admin).post('/departments', { code: 'BUS-B', name: '业务B' })).body.id;
    const salespersonId = (await api(ctx.app, admin).post('/users', { employeeNo: 'BS-A1', name: '业务员', departmentId: businessDepartmentId, roles: [{ role: 'SALES', departmentId: businessDepartmentId }] })).body.id;
    supervisorId = (await api(ctx.app, admin).post('/users', { employeeNo: 'BS-S1', name: '主管', roles: [{ role: 'QC_SUPERVISOR' }] })).body.id;
    inspectorId = (await api(ctx.app, admin).post('/users', { employeeNo: 'BS-I1', name: '跟单员', roles: [{ role: 'INSPECTOR' }] })).body.id;
    inspector = (await bindWechat(ctx.app, admin, inspectorId, 'BS-I1', 'bs-i1')).accessToken;
    supervisor = (await bindWechat(ctx.app, admin, supervisorId, 'BS-S1', 'bs-s1')).accessToken;
    salesperson = (await bindWechat(ctx.app, admin, salespersonId, 'BS-A1', 'bs-a1')).accessToken;
    standardId = (await api(ctx.app, admin).get('/standards?kind=FOUR_POINT')).body.find((s: { code: string }) => s.code === 'FOUR_POINT_DEV').id;
    templateId = (await api(ctx.app, admin).get('/templates')).body.find((t: { code: string }) => t.code === 'DEFAULT').id;
    fabricId = (await api(ctx.app, admin).post('/fabrics', { code: 'BUS-F', nameZh: '业务测试布', widthCm: 150, gsm: 200, defaultFourPointStandardId: standardId, defaultTemplateId: templateId })).body.id;
  });
  afterAll(async () => { await ctx.app.close(); });
  it('业务员可创建待分发任务，不能创建跨部门任务', async () => {
    const body = { title: '测试订单', businessDepartmentId, supervisorId, plannedRollCount: 10, fourPointStandardId: standardId, templateId };
    const created = await api(ctx.app, salesperson).post('/tasks/business', body);
    expect(created.status).toBe(201);
    taskId = created.body.id;
    expect((await ctx.prisma.notification.findFirstOrThrow({ where: { userId: supervisorId, type: 'BUSINESS_TASK', entityId: taskId } })).pagePath).toBe(`/pages/task/index?id=${taskId}`);
    const stored = await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.origin).toBe('BUSINESS');
    expect(stored.assigneeId).toBeNull();
    expect(stored.businessDepartmentId).toBe(businessDepartmentId);
    const forbidden = await api(ctx.app, salesperson).post('/tasks/business', { ...body, businessDepartmentId: otherDepartmentId });
    expect(forbidden.status).toBe(403);
  });
  it('指定主管分派一人，业务员不能自行分派', async () => {
    expect((await api(ctx.app, salesperson).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId })).status).toBe(403);
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/assignment`, { assigneeId: inspectorId })).status).toBe(201);
    expect((await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: taskId } })).assigneeId).toBe(inspectorId);
    expect(await ctx.prisma.qcTaskAssignmentEvent.count({ where: { taskId } })).toBe(1);
  });
  it('业务列表仅本部门，未交付只返回基础和汇总字段', async () => {
    const result = await api(ctx.app, salesperson).get('/tasks/business');
    expect(result.status).toBe(200);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ id: taskId, plannedRollCount: 10, inspected: 0, uninspected: 10 });
    expect(JSON.stringify(result.body)).not.toContain('overallResult');
  });
  it('业务员不能通过旧任务详情接口绕过未交付限制', async () => {
    expect((await api(ctx.app, salesperson).get(`/tasks/${taskId}`)).status).toBe(403);
  });
  it('跟单员补录卷号，超过计划及重复卷号不得写入', async () => {
    const data = { fabricId, rolls: [{ rollNo: 'BUS-01', nominalLengthM: 50 }] };
    expect((await api(ctx.app, salesperson).post(`/tasks/${taskId}/rolls/register`, data)).status).toBe(403);
    const result = await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, data);
    expect(result.status).toBe(201);
    expect(result.body.items[0]).toMatchObject({ rollNo: 'BUS-01', taskRollId: expect.any(String) });
    expect((await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, data)).status).toBe(409);
    const tooMany = Array.from({ length: 10 }, (_, i) => ({ rollNo: `BUS-${i + 2}` }));
    expect((await api(ctx.app, inspector).post(`/tasks/${taskId}/rolls/register`, { fabricId, rolls: tooMany })).status).toBe(409);
    expect(await ctx.prisma.qcTaskRoll.count({ where: { taskId } })).toBe(1);
  });
  it('仅本部门业务员在可审核时催审，连续请求限频', async () => {
    const key = '6dc8c34c-b3f4-4e80-9782-11b961b3bd4a';
    expect((await api(ctx.app, salesperson).post(`/tasks/${taskId}/reminders`, { idempotencyKey: key })).status).toBe(409);
    const tr = await ctx.prisma.qcTaskRoll.findFirstOrThrow({ where: { taskId } });
    const version = await ctx.prisma.standardVersion.findFirstOrThrow({ where: { standardId } });
    await ctx.prisma.rollInspection.create({ data: { inspectionNo: 'BUS-QC-1', taskId, taskRollId: tr.id, rollId: tr.rollId, inspectorId, mode: 'MANUAL', scope: 'FULL', status: 'SUBMITTED', revision: 1, fourPointVersionId: version.id, standardSnapshot: {}, templateSnapshot: {}, specSnapshot: {} } });
    const first = await api(ctx.app, salesperson).post(`/tasks/${taskId}/reminders`, { idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(first.body.accepted).toBe(true);
    expect((await ctx.prisma.notification.findFirstOrThrow({ where: { userId: supervisorId, type: 'BUSINESS_REVIEW_REMINDER', entityId: taskId } })).pagePath).toBe(`/pages/task/index?id=${taskId}`);
    const repeat = await api(ctx.app, salesperson).post(`/tasks/${taskId}/reminders`, { idempotencyKey: key });
    expect(repeat.body.reminderId).toBe(first.body.reminderId);
    expect((await api(ctx.app, salesperson).post(`/tasks/${taskId}/reminders`, { idempotencyKey: '25785791-a9b8-4c8a-b152-82779f59b196' })).status).toBe(409);
    expect(await ctx.prisma.qcReviewReminder.count({ where: { taskId } })).toBe(1);
  });
  it('业务详情进度仅本部门可读', async () => {
    const response = await api(ctx.app, salesperson).get(`/tasks/${taskId}/business-progress`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: taskId, plannedRollCount: 10, registered: 1, inspected: 1, uninspected: 9 });
    expect(JSON.stringify(response.body)).not.toContain('overallResult');
    expect((await api(ctx.app, inspector).get(`/tasks/${taskId}/business-progress`)).status).toBe(403);
  });
  it('业务员不能从旧检验详情、历史与看板读取未交付数据', async () => {
    const i = await ctx.prisma.rollInspection.findFirstOrThrow({ where: { taskId } });
    expect((await api(ctx.app, salesperson).get(`/inspections/${i.id}`)).status).toBe(403);
    expect((await api(ctx.app, salesperson).get(`/rolls/${i.rollId}/history`)).status).toBe(403);
    const dashboard = await api(ctx.app, salesperson).get('/dashboard/summary');
    expect(dashboard.status).toBe(403);
  });
  it('旧列表和布卷接口不可泄漏业务记录', async () => {
    const i = await ctx.prisma.rollInspection.findFirstOrThrow({ where: { taskId } });
    expect((await api(ctx.app, salesperson).get('/tasks')).status).toBe(403);
    expect((await api(ctx.app, salesperson).get('/inspections')).status).toBe(403);
    expect((await api(ctx.app, salesperson).get(`/rolls/${i.rollId}`)).status).toBe(403);
    expect((await api(ctx.app, salesperson).get('/rolls')).status).toBe(403);
  });
  it('登记不足时不能整单确认；审核确认与质量结果相互独立', async () => {
    expect((await api(ctx.app, supervisor).post(`/tasks/${taskId}/delivery`, {})).status).toBe(409);
    const one = await api(ctx.app, salesperson).post('/tasks/business', { title: '不合格确认测试', businessDepartmentId, supervisorId, plannedRollCount: 1, fourPointStandardId: standardId, templateId });
    const oneId = one.body.id;
    await api(ctx.app, supervisor).post(`/tasks/${oneId}/assignment`, { assigneeId: inspectorId });
    const reg = await api(ctx.app, inspector).post(`/tasks/${oneId}/rolls/register`, { fabricId, rolls: [{ rollNo: 'BUS-FAIL' }] });
    const roll = reg.body.items[0];
    const version = await ctx.prisma.standardVersion.findFirstOrThrow({ where: { standardId } });
    const inspection = await ctx.prisma.rollInspection.create({ data: { inspectionNo: 'BUS-FAIL-QC', taskId: oneId, taskRollId: roll.taskRollId, rollId: roll.rollId, inspectorId, mode: 'MANUAL', scope: 'FULL', status: 'APPROVED', revision: 1, overallResult: 'FAIL', fourPointVersionId: version.id, standardSnapshot: {}, templateSnapshot: {}, specSnapshot: {} } });
    await ctx.prisma.inspectionRevision.create({ data: { inspectionId: inspection.id, revision: 1, idempotencyKey: '4f693f80-0580-4eca-a37a-d892d94f4174', submittedById: inspectorId, snapshot: { photos: [], evaluation: { overall: { result: 'FAIL' } } } } });
    await ctx.prisma.qcReview.create({ data: { inspectionId: inspection.id, revision: 1, reviewerId: supervisorId, decision: 'APPROVE', comment: '确认不合格', isConcession: true } });
    const [result, concurrent] = await Promise.all([api(ctx.app, supervisor).post(`/tasks/${oneId}/delivery`, {}), api(ctx.app, supervisor).post(`/tasks/${oneId}/delivery`, {})]);
    expect([result.status, concurrent.status]).toEqual([201, 201]);
    expect(result.body.id).toBe(concurrent.body.id);
    expect([result.body.replayed, concurrent.body.replayed].sort()).toEqual([false, true]);
    expect(await ctx.prisma.qcTaskDelivery.count({ where: { taskId: oneId } })).toBe(1);
    expect(await ctx.prisma.notificationOutbox.count({ where: { dedupeKey: `task-delivered:${result.body.id}` } })).toBe(1);
    const snapshot = await api(ctx.app, salesperson).get(`/tasks/${oneId}/delivery`);
    expect(snapshot.status).toBe(200);
    expect(JSON.stringify(snapshot.body)).toContain('FAIL');
    const replay = await api(ctx.app, supervisor).post(`/tasks/${oneId}/delivery`, {});
    expect(replay.body.replayed).toBe(true);
    const outbox = await ctx.prisma.notificationOutbox.findUniqueOrThrow({ where: { dedupeKey: `task-delivered:${result.body.id}` } });
    await ctx.app.get(DeliveryService).deliver(outbox.id);
    const deliveryStatus = await api(ctx.app, salesperson).get(`/tasks/${oneId}/notification-status`);
    expect(deliveryStatus.body).toMatchObject({ status: 'SKIPPED', reason: 'TEMPLATE_NOT_CONFIGURED' });
    expect((await api(ctx.app, admin).post(`/inspections/${inspection.id}/reopen`, { reason: '申请复验' })).status).toBe(409);
  });
  it('业务建单选项只包含授权部门和必要人员资料', async () => {
    const response = await api(ctx.app, salesperson).get('/tasks/business/options');
    expect(response.status).toBe(200);
    expect(response.body.departments.map((d: { id: string }) => d.id)).toEqual([businessDepartmentId]);
    expect(response.body.supervisors).toEqual(expect.arrayContaining([expect.objectContaining({ id: supervisorId })]));
    expect(response.body.standards).toEqual(expect.arrayContaining([expect.objectContaining({ id: standardId })]));
    expect(JSON.stringify(response.body)).not.toContain('password');
  });
  it('未登记完计划卷不能因现有卷均完成而自动结束任务', async () => {
    const one = await api(ctx.app, salesperson).post('/tasks/business', { title: '部分登记', businessDepartmentId, supervisorId, plannedRollCount: 2, fourPointStandardId: standardId, templateId });
    await api(ctx.app, supervisor).post(`/tasks/${one.body.id}/assignment`, { assigneeId: inspectorId });
    const reg = await api(ctx.app, inspector).post(`/tasks/${one.body.id}/rolls/register`, { fabricId, rolls: [{ rollNo: 'PART-1' }] });
    await ctx.prisma.qcTaskRoll.update({ where: { id: reg.body.items[0].taskRollId }, data: { status: 'DONE' } });
    const { TasksService } = await import('../src/tasks/tasks.service');
    const tasks = ctx.app.get(TasksService);
    await ctx.prisma.$transaction((tx) => tasks.completeIfDone(tx, one.body.id));
    expect((await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: one.body.id } })).status).not.toBe('COMPLETED');
  });
  it('业务单不合格记录可审核确认，不能自动标为让步接收', async () => {
    const one = await api(ctx.app, salesperson).post('/tasks/business', { title: '结果确认', businessDepartmentId, supervisorId, plannedRollCount: 1, fourPointStandardId: standardId, templateId });
    await api(ctx.app, supervisor).post(`/tasks/${one.body.id}/assignment`, { assigneeId: inspectorId });
    const reg = await api(ctx.app, inspector).post(`/tasks/${one.body.id}/rolls/register`, { fabricId, rolls: [{ rollNo: 'FAIL-REVIEW' }] });
    const version = await ctx.prisma.standardVersion.findFirstOrThrow({ where: { standardId } });
    const i = await ctx.prisma.rollInspection.create({ data: { inspectionNo: 'FAIL-REVIEW-QC', taskId: one.body.id, taskRollId: reg.body.items[0].taskRollId, rollId: reg.body.items[0].rollId, inspectorId, mode: 'MANUAL', scope: 'FULL', status: 'SUBMITTED', revision: 1, overallResult: 'FAIL', fourPointVersionId: version.id, standardSnapshot: {}, templateSnapshot: {}, specSnapshot: {} } });
    const result = await api(ctx.app, supervisor).post(`/reviews/${i.id}/decide`, { revision: 1, decision: 'APPROVE' });
    expect(result.status).toBe(200);
    expect(result.body.isConcession).toBe(false);
    expect((await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { id: i.id } })).overallResult).toBe('FAIL');
  });
  it('其他跟单员不能通过布卷接口获取未分配的卷', async () => {
    const user = await api(ctx.app, admin).post('/users', { employeeNo: 'BS-I2', name: '其他跟单员', roles: [{ role: 'INSPECTOR' }] });
    const other = (await bindWechat(ctx.app, admin, user.body.id, 'BS-I2', 'bs-i2')).accessToken;
    const tr = await ctx.prisma.qcTaskRoll.findFirstOrThrow({ where: { taskId } });
    expect((await api(ctx.app, other).get(`/rolls/${tr.rollId}`)).status).toBe(403);
  });
  it('纯业务员不能通过标签接口枚举业务布卷信息', async () => {
    const tr = await ctx.prisma.qcTaskRoll.findFirstOrThrow({ where: { taskId } });
    expect((await api(ctx.app, salesperson).post('/rolls/labels', { ids: [tr.rollId] })).status).toBe(403);
  });
  it('质检员可查看自己职责内的布卷历史，其他跟单员不可查看', async () => {
    const tr = await ctx.prisma.qcTaskRoll.findFirstOrThrow({ where: { taskId } });
    expect((await api(ctx.app, inspector).get(`/rolls/${tr.rollId}/history`)).status).toBe(200);
    const user = await api(ctx.app, admin).post('/users', { employeeNo: 'BS-I3', name: '外部跟单', roles: [{ role: 'INSPECTOR' }] });
    const other = (await bindWechat(ctx.app, admin, user.body.id, 'BS-I3', 'bs-i3')).accessToken;
    expect((await api(ctx.app, other).get(`/rolls/${tr.rollId}/history`)).status).toBe(403);
  });
  it('质检主管可查看职责范围看板', async () => {
    const response = await api(ctx.app, supervisor).get('/dashboard/summary');
    expect(response.status).toBe(200);
    expect(response.body.tasksByStatus).toBeDefined();
  });
  it('检验员搜索不能覆盖自身任务范围', async () => {
    const user = await api(ctx.app, admin).post('/users', { employeeNo: 'BS-I4', name: '外部跟单二', roles: [{ role: 'INSPECTOR' }] });
    const other = (await bindWechat(ctx.app, admin, user.body.id, 'BS-I4', 'bs-i4')).accessToken;
    const result = await api(ctx.app, other).get('/tasks?q=测试订单');
    expect(result.status).toBe(200);
    expect(result.body.items).toHaveLength(0);
  });
  it('任务改派后旧跟单员不能签发照片上传链接', async () => {
    const i = await ctx.prisma.rollInspection.findFirstOrThrow({ where: { taskId } });
    const user = await api(ctx.app, admin).post('/users', { employeeNo: 'BS-I5', name: '改派人员', roles: [{ role: 'INSPECTOR' }] });
    await ctx.prisma.rollInspection.update({ where: { id: i.id }, data: { status: 'DRAFT' } });
    await ctx.prisma.qcTask.update({ where: { id: taskId }, data: { assigneeId: user.body.id } });
    expect((await api(ctx.app, inspector).post('/media/upload-intents', { inspectionId: i.id, mimeType: 'image/jpeg', sizeBytes: 100 })).status).toBe(403);
    const media = await ctx.prisma.mediaAsset.create({ data: { provider: 'minio', bucket: 'test', objectKey: 'pending/reassigned-test', mimeType: 'image/jpeg', inspectionId: i.id, uploadedById: inspectorId } });
    expect((await api(ctx.app, inspector).post(`/media/${media.id}/confirm`)).status).toBe(403);
  });
  it.each(['SALES', 'BUSINESS_MANAGER', 'BUSINESS_CLERK'])('业务角色 %s 必须明确部门', async (role) => {
    const response = await api(ctx.app, admin).post('/users', { employeeNo: `NO-${role}`, name: '缺少部门', roles: [{ role }] });
    expect(response.status).toBe(400);
  });
  it('纯部门经理可登录并获取部门范围', async () => {
    const user = await api(ctx.app, admin).post('/users', { employeeNo: 'BUS-MGR', name: '部门经理', username: 'test-business-manager', password: 'PUBLIC_REDACTED', roles: [{ role: 'BUSINESS_MANAGER', departmentId: businessDepartmentId }] });
    expect(user.status).toBe(201);
    const token = await adminLogin(ctx.app, 'test-business-manager', 'TestAdmin12345');
    const me = await api(ctx.app, token).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'BUSINESS_MANAGER', departmentId: businessDepartmentId })]));
    expect((await api(ctx.app, token).get('/tasks/business')).status).toBe(200);
    expect((await api(ctx.app, token).post(`/tasks/${taskId}/reminders`, { idempotencyKey: '0aa21335-8ea9-40e7-af0d-895e8e938302' })).status).toBe(403);
  });
  it('计划十卷只登记并确认一卷后仍可补录九卷，不会提前完成或通知', async () => {
    const task = (await api(ctx.app, salesperson).post('/tasks/business', { title: '十卷逐步补录', businessDepartmentId, supervisorId, plannedRollCount: 10, fourPointStandardId: standardId, templateId })).body;
    await api(ctx.app, supervisor).post(`/tasks/${task.id}/assignment`, { assigneeId: inspectorId });
    const first = (await api(ctx.app, inspector).post(`/tasks/${task.id}/rolls/register`, { fabricId, rolls: [{ rollNo: 'TEN-01' }] })).body.items[0];
    const version = await ctx.prisma.standardVersion.findFirstOrThrow({ where: { standardId } });
    const i = await ctx.prisma.rollInspection.create({ data: { inspectionNo: 'TEN-QC-01', taskId: task.id, taskRollId: first.taskRollId, rollId: first.rollId, inspectorId, mode: 'MANUAL', scope: 'FULL', status: 'SUBMITTED', revision: 1, overallResult: 'PASS', fourPointVersionId: version.id, standardSnapshot: {}, templateSnapshot: {}, specSnapshot: {} } });
    expect((await api(ctx.app, supervisor).post(`/reviews/${i.id}/decide`, { revision: 1, decision: 'APPROVE' })).status).toBe(200);
    expect((await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: task.id } })).status).not.toBe('COMPLETED');
    const rest = Array.from({ length: 9 }, (_, index) => ({ rollNo: `TEN-${index + 2}` }));
    expect((await api(ctx.app, inspector).post(`/tasks/${task.id}/rolls/register`, { fabricId, rolls: rest })).status).toBe(201);
    expect((await api(ctx.app, salesperson).get(`/tasks/${task.id}/delivery`)).status).toBe(409);
    expect(await ctx.prisma.notificationOutbox.count({ where: { eventType: 'TASK_DELIVERED', payload: { path: ['taskId'], equals: task.id } } })).toBe(0);
  });
  it('业务任务逐卷全部完成仍待整单确认，不提前标完成', async () => {
    const task = (await api(ctx.app, salesperson).post('/tasks/business', { title: '等待最终确认', businessDepartmentId, supervisorId, plannedRollCount: 1, fourPointStandardId: standardId, templateId })).body;
    await api(ctx.app, supervisor).post(`/tasks/${task.id}/assignment`, { assigneeId: inspectorId });
    const reg = (await api(ctx.app, inspector).post(`/tasks/${task.id}/rolls/register`, { fabricId, rolls: [{ rollNo: 'FINAL-1' }] })).body.items[0];
    await ctx.prisma.qcTaskRoll.update({ where: { id: reg.taskRollId }, data: { status: 'DONE' } });
    const { TasksService } = await import('../src/tasks/tasks.service');
    await ctx.prisma.$transaction((tx) => ctx.app.get(TasksService).completeIfDone(tx, task.id));
    expect((await ctx.prisma.qcTask.findUniqueOrThrow({ where: { id: task.id } })).status).not.toBe('COMPLETED');
  });
  it('旧布卷更新接口不能绕过业务任务管理', async () => {
    const tr = await ctx.prisma.qcTaskRoll.findFirstOrThrow({ where: { taskId } });
    const response = await api(ctx.app, admin).put(`/rolls/${tr.rollId}`, { fabricId, notes: '旧入口篡改' });
    expect(response.status).toBe(409);
  });
  it('限部门主管带搜索不能越权查看其他主管任务', async () => {
    const qcDept = (await api(ctx.app, admin).post('/departments', { code: 'QC-OTHER', name: '其他质检部' })).body.id;
    const user = (await api(ctx.app, admin).post('/users', { employeeNo: 'QC-OTHER-S', name: '其他主管', departmentId: qcDept, roles: [{ role: 'QC_SUPERVISOR', departmentId: qcDept }] })).body;
    const other = (await bindWechat(ctx.app, admin, user.id, 'QC-OTHER-S', 'qc-other-s')).accessToken;
    const result = await api(ctx.app, other).get('/tasks?q=测试订单');
    expect(result.status).toBe(200);
    expect(result.body.items).toHaveLength(0);
  });
  it('职责范围外的主管不能对其他人的检验发起复验', async () => {
    const dept = (await api(ctx.app, admin).post('/departments', { code: 'QC-NOSCOPE', name: '非负责质检部' })).body.id;
    const person = (await api(ctx.app, admin).post('/users', { employeeNo: 'QC-NOSCOPE', name: '非负责主管', departmentId: dept, roles: [{ role: 'QC_SUPERVISOR', departmentId: dept }] })).body;
    const token = (await bindWechat(ctx.app, admin, person.id, 'QC-NOSCOPE', 'qc-no-scope')).accessToken;
    const target = await ctx.prisma.rollInspection.findUniqueOrThrow({ where: { inspectionNo: 'FAIL-REVIEW-QC' } });
    expect((await api(ctx.app, token).post(`/inspections/${target.id}/reopen`, { reason: '重验' })).status).toBe(403);
  });
  it('其他部门主管不能通过旧任务更新入口改动任务', async () => {
    const dept = (await api(ctx.app, admin).post('/departments', { code: 'QC-LEGACY-X', name: '无关质检' })).body.id;
    const user = (await api(ctx.app, admin).post('/users', { employeeNo: 'QC-LX', name: '无关主管', roles: [{ role: 'QC_SUPERVISOR', departmentId: dept }] })).body;
    const outsider = (await bindWechat(ctx.app, admin, user.id, 'QC-LX', 'qc-lx')).accessToken;
    const standard = await ctx.prisma.qualityStandard.findUniqueOrThrow({ where: { id: standardId } });
    const raw = await api(ctx.app, admin).post('/rolls', { rollNo: 'LEGACY-SCOPE-1', fabricId, nominalLengthM: 50 });
    const created = await api(ctx.app, admin).post('/tasks', { title: '旧任务', assigneeId: inspectorId, fourPointStandardId: standard.id, templateId, rollIds: [raw.body.id] });
    expect(created.status).toBe(201);
    expect((await api(ctx.app, outsider).put(`/tasks/${created.body.id}`, { title: '跨范围修改' })).status).toBe(403);
  });
});
