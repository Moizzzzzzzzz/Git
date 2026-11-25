import { RoleCode } from '@fabricqc/shared';
import * as renderer from './document-renderer';
import { VcansReportService } from './vcans-report.service';

it('renders each frozen history with its own scoring unit, including historical area units', async () => {
  const event = (unit: string) => ({ inspectionId: unit, result: 'PASS', submittedAt: '2026-11-17T00:00:00Z', reviewedAt: '2026-11-17T01:00:00Z', resultSnapshot: { fourPoint: { scoring: { areaUnit: unit } } }, inspection: { defects: [], photos: [] } });
  const snapshot = { hNo: 'TEST-H', plan: { mode: 'FULL' }, rolls: [{ id: 'r', lineId: 'l', lotNo: 'TEST', rollNo: 'TEST', result: 'PASS', originalSample: true, basisHistory: event('PER_100_SQ_YD'), additionalHistory: [event('PER_100_SQ_M'), event('PER_100_LINEAR_YD')] }] };
  const saved = { id: 'report', snapshot, files: [] };
  const tx = { $queryRaw: jest.fn(), vcansReportFile: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
  const prisma = { vcansOrder: { findUnique: jest.fn().mockResolvedValue({ businessDepartmentId: 'department' }) }, vcansReportVersion: { findUnique: jest.fn().mockResolvedValue(saved) }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const storage = { putBytesIfAbsent: jest.fn() };
  const render = jest.spyOn(renderer, 'renderOrderReport').mockResolvedValue(Buffer.from('%PDF-test'));
  try {
    await new VcansReportService(prisma as never, storage as never).pdf({ userId: 'user', roles: [{ role: RoleCode.SALES, departmentId: 'department' }] } as never, 'order', 1);
    const input = render.mock.calls[0][0];
    expect(input.rolls[0].inspectionHistory?.map(item => item.scoreUnit)).toEqual(['分/100平方码', '分/100平方米', '分/100线码']);
  } finally { render.mockRestore(); }
});
