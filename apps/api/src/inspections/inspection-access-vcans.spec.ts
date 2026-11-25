import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';
import { InspectionAccess, type InspectionRef } from './inspection-access';
const actor = (id: string, role: RoleCode): Actor => ({ userId: id, name: '', employeeNo: '', departmentId: 'q', roles: [{ role, departmentId: 'q' }], sessionId: 'test', clientType: 'ADMIN_WEB' });
const entry: InspectionRef = { id: 'inspection', inspectorId: 'inspector', status: 'SUBMITTED', revision: 1, taskDepartmentId: 'q', inspectorDepartmentId: 'q', vcansSupervisorId: 'specified', isVcans: true };
describe('H订单指定主管权限', () => {
  const access = new InspectionAccess({} as never);
  it('同部门其他主管不能查看或审核', async () => {
    expect(access.canView(actor('other', RoleCode.QC_SUPERVISOR), entry)).toBe(false);
    await expect(access.canReview(actor('other', RoleCode.QC_SUPERVISOR), entry)).resolves.toBe(false);
  });
  it('指定主管和质量经理保留权限，验布人不能审核自己', async () => {
    expect(access.canView(actor('specified', RoleCode.QC_SUPERVISOR), entry)).toBe(true);
    await expect(access.canReview(actor('specified', RoleCode.QC_SUPERVISOR), entry)).resolves.toBe(true);
    await expect(access.canReview(actor('manager', RoleCode.QUALITY_MANAGER), entry)).resolves.toBe(true);
    await expect(access.canReview(actor('inspector', RoleCode.QC_SUPERVISOR), entry)).resolves.toBe(false);
  });
  it('普通旧任务保留原部门主管规则', async () => {
    const legacy = { ...entry, isVcans: false };
    expect(access.canView(actor('other', RoleCode.QC_SUPERVISOR), legacy)).toBe(true);
    await expect(access.canReview(actor('other', RoleCode.QC_SUPERVISOR), legacy)).resolves.toBe(true);
  });
});
