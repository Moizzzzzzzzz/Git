import { TasksService } from './tasks.service';
it('旧任务不能接管尚未激活的H订单布卷', async () => {
  const tx = { fabricRoll: { findMany: jest.fn().mockResolvedValue([{ id: 'r', status: 'PENDING', rollNo: 'TEST' }]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, qcTaskRoll: { createMany: jest.fn() }, vcansOrderRoll: { count: jest.fn().mockResolvedValue(1) } };
  const service = new TasksService({} as never, {} as never, {} as never, {} as never, {} as never);
  const attach = service as unknown as { attachRolls(tx: unknown, task: string, ids: string[]): Promise<void> };
  await expect(attach.attachRolls(tx, 'legacy', ['r'])).rejects.toThrow();
});
