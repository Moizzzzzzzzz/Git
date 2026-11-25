import { DeliveryService } from './delivery.service';
import { OutboxEvent } from './notifications.service';
it('H订单完成通知指向同一订单详情而非旧任务', async () => {
  const prisma = { vcansReportVersion: { findUnique: jest.fn().mockResolvedValue({ order: { id: 'order-id', hNo: 'TEST-H' } }) } };
  const config = { env: { WECHAT_TPL_TASK_DELIVERED: 'TEST', WECHAT_TPL_TASK_DELIVERED_FIELDS: {} } };
  const service = new DeliveryService(prisma as never, {} as never, config as never);
  const message = await (service as unknown as { buildMessage(type: string, payload: object): Promise<{ page: string; values: { taskLabel: string } }> }).buildMessage(OutboxEvent.VCANS_ORDER_DELIVERED, { reportVersionId: 'report-id', recipientIds: [] });
  expect(message.page).toBe('pages/orders/detail?id=order-id');
  expect(message.values.taskLabel).toBe('TEST-H');
});
