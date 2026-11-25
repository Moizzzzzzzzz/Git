import { RoleCode } from '@fabricqc/shared';
import { VcansLabelService } from './vcans-label.service';
import type { Actor } from '../common/actor';
it('业务员不能获得布卷标签打印权限', async () => {
  const actor: Actor = { userId: 'u', name: '', employeeNo: '', departmentId: 'a', roles: [{ role: RoleCode.SALES, departmentId: 'a' }], sessionId: 's', clientType: 'ADMIN_WEB' };
  const service = new VcansLabelService({} as never);
  await expect(service.data(actor, 'roll', 'REPRINT')).rejects.toThrow();
});
