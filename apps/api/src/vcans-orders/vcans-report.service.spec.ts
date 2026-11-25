import { VcansReportService } from './vcans-report.service';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
const actor: Actor = { userId: 'u', name: '', employeeNo: '', departmentId: 'a', roles: [{ role: RoleCode.SALES, departmentId: 'a' }], sessionId: 's', clientType: 'ADMIN_WEB' };
it('跨部门用户不能读取历史报告', async () => {
  const prisma = { vcansOrder: { findUnique: jest.fn().mockResolvedValue({ businessDepartmentId: 'b', supervisorId: 's', assignedInspectorId: null }) }, vcansReportVersion: { findMany: jest.fn() } };
  const service = new VcansReportService(prisma as never, {} as never);
  await expect(service.list(actor, 'order')).rejects.toThrow();
  expect(prisma.vcansReportVersion.findMany).not.toHaveBeenCalled();
});
