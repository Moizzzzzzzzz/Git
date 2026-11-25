import { DeliveryService } from '../src/notifications/delivery.service';
import { adminLogin, api, bindWechat, createTestApp, type TestContext } from './helpers';

describe('整单确认订阅消息', () => {
  let ctx: TestContext;
  const previousTemplate = process.env.WECHAT_TPL_TASK_DELIVERED;
  beforeAll(async () => { process.env.WECHAT_TPL_TASK_DELIVERED = 'TPL_TASK_DELIVERED_TEST'; ctx = await createTestApp(); });
  afterAll(async () => { await ctx.app.close(); if (previousTemplate === undefined) delete process.env.WECHAT_TPL_TASK_DELIVERED; else process.env.WECHAT_TPL_TASK_DELIVERED = previousTemplate; });
  it('订阅后仅向发起人发送一次且不表示布料合格', async () => {
    const admin = await adminLogin(ctx.app);
    const dept = (await api(ctx.app, admin).post('/departments', { code: 'MSG-B', name: '消息业务部' })).body.id;
    const user = (await api(ctx.app, admin).post('/users', { employeeNo: 'MSG-S', name: '消息业务员', departmentId: dept, roles: [{ role: 'SALES', departmentId: dept }] })).body.id;
    const sup = (await api(ctx.app, admin).post('/users', { employeeNo: 'MSG-Q', name: '消息主管', roles: [{ role: 'QC_SUPERVISOR' }] })).body.id;
    const token = (await bindWechat(ctx.app, admin, user, 'MSG-S', 'msg-s')).accessToken;
    const standard = (await api(ctx.app, admin).get('/standards?kind=FOUR_POINT')).body.find((x: { code: string }) => x.code === 'FOUR_POINT_DEV').id;
    const template = (await api(ctx.app, admin).get('/templates')).body.find((x: { code: string }) => x.code === 'DEFAULT').id;
    const task = (await api(ctx.app, token).post('/tasks/business', { title: '通知测试', businessDepartmentId: dept, supervisorId: sup, plannedRollCount: 1, fourPointStandardId: standard, templateId: template })).body;
    const delivery = await ctx.prisma.qcTaskDelivery.create({ data: { taskId: task.id, confirmedById: sup, plannedRollCount: 1, snapshot: {} } });
    const ob = await ctx.prisma.notificationOutbox.create({ data: { eventType: 'TASK_DELIVERED', dedupeKey: `task-delivered:${delivery.id}`, payload: { deliveryId: delivery.id, recipientIds: [user] } } });
    const subscriptions = await api(ctx.app, token).get('/notifications/wechat-subscriptions');
    expect(subscriptions.body.templates.taskDelivered).toBe('TPL_TASK_DELIVERED_TEST');
    expect((await api(ctx.app, token).post('/notifications/wechat-subscriptions', { results: [{ templateId: 'TPL_TASK_DELIVERED_TEST', accepted: true }] })).status).toBe(200);
    const svc = ctx.app.get(DeliveryService);
    ctx.wechat.failNextWith = -1;
    await expect(svc.deliver(ob.id)).rejects.toThrow();
    expect((await ctx.prisma.wechatSubscription.findFirstOrThrow({ where: { userId: user, templateId: 'TPL_TASK_DELIVERED_TEST' } })).remaining).toBe(1);
    await svc.deliver(ob.id);
    await svc.deliver(ob.id);
    expect(ctx.wechat.sent).toHaveLength(1);
    expect(ctx.wechat.sent[0].data).toMatchObject({ thing1: { value: task.taskNo }, phrase2: { value: '已完成' }, thing3: { value: '主管已确认结果请查看详情' } });
    expect(ctx.wechat.sent[0].page).toBe(`pages/business/index?id=${task.id}`);
    expect((await api(ctx.app, token).get(`/tasks/${task.id}/notification-status`)).body.status).toBe('SENT');
  });
});
