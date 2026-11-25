import { VcansImportService } from './vcans-import.service';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
const actor: Actor = { userId: 'user', name: '', employeeNo: '', departmentId: 'A', roles: [{ role: RoleCode.SALES, departmentId: 'A' }], sessionId: 's', clientType: 'ADMIN_WEB' };
it('跨部门导入在解析或访问数据库前拒绝', async () => {
  const db = { vcansImportBatch: { findUnique: jest.fn() } };
  const service = new VcansImportService(db as never);
  await expect(service.preview(actor, { businessDepartmentId: 'B', idempotencyKey: 'key', filename: 'x.xls', fileBase64: 'YWJj' })).rejects.toThrow();
  expect(db.vcansImportBatch.findUnique).not.toHaveBeenCalled();
});
