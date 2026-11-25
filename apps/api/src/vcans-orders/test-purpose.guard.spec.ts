import 'reflect-metadata';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionPurposeGuard, LotPurposeGuard, MediaPurposeGuard, OrderPurposeGuard, RollPurposeGuard, TaskPurposeGuard } from './test-purpose.guard';

const id = '00000000-0000-4000-8000-000000000001';
const context = (value?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ params: { id: value } }) }) }) as never;
it('hides explicitly archived test orders only in production and keeps UNKNOWN historical access', async () => {
  const findUnique = jest.fn().mockResolvedValue({ purpose: 'TEST' });
  const prisma = { vcansOrder: { findUnique } };
  const prod = new OrderPurposeGuard(prisma as never, { env: { DEMO_RUNTIME_MODE: 'production' } } as never);
  await expect(prod.canActivate(context(id))).rejects.toThrow();
  const demo = new OrderPurposeGuard(prisma as never, { env: { DEMO_RUNTIME_MODE: 'demo' } } as never);
  await expect(demo.canActivate(context(id))).resolves.toBe(true);
  findUnique.mockResolvedValue({ purpose: 'UNKNOWN' });
  await expect(prod.canActivate(context(id))).resolves.toBe(true);
  expect(Reflect.getMetadata('design:paramtypes', OrderPurposeGuard)).toEqual([PrismaService, AppConfig]);
});
it('hides archived TEST through lot, roll, legacy task, inspection and media identifiers', async () => {
  const task = { purpose: 'UNKNOWN', vcansOrder: { purpose: 'TEST' } };
  const prisma = {
    vcansDyeLot: { findUnique: jest.fn().mockResolvedValue({ line: { order: { purpose: 'TEST' } } }) },
    fabricRoll: { findUnique: jest.fn().mockResolvedValue({ fabric: null, vcansOrderRoll: { lot: { line: { order: { purpose: 'TEST' } } } }, taskRolls: [] }) },
    qcTask: { findUnique: jest.fn().mockResolvedValue(task) },
    qcTaskRoll: { findUnique: jest.fn().mockResolvedValue({ task }) },
    rollInspection: { findUnique: jest.fn().mockResolvedValue({ task }) },
    mediaAsset: { findUnique: jest.fn().mockResolvedValue({ inspectionId: id }) },
  };
  const config = { env: { DEMO_RUNTIME_MODE: 'production' } };
  for (const Guard of [LotPurposeGuard, RollPurposeGuard, TaskPurposeGuard, InspectionPurposeGuard, MediaPurposeGuard]) await expect(new Guard(prisma as never, config as never).canActivate(context(id))).rejects.toThrow();
  const begin = { switchToHttp: () => ({ getRequest: () => ({ params: {}, body: { taskRollId: id } }) }) } as never;
  await expect(new InspectionPurposeGuard(prisma as never, config as never).canActivate(begin)).rejects.toThrow();
  const upload = { switchToHttp: () => ({ getRequest: () => ({ params: {}, body: { inspectionId: id } }) }) } as never;
  await expect(new MediaPurposeGuard(prisma as never, config as never).canActivate(upload)).rejects.toThrow();
});
