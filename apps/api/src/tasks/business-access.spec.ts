import { businessDepartments } from './business-access';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';

const actor = (roles: Actor['roles']): Actor => ({ userId: 'u', name: 'n', employeeNo: 'n', departmentId: 'a', roles, sessionId: 's', clientType: 'ADMIN_WEB' });
describe('业务部门授权', () => {
  it('忽略业务角色空部门并去重', () => {
    expect(businessDepartments(actor([{ role: RoleCode.SALES, departmentId: null }, { role: RoleCode.SALES, departmentId: 'a' }, { role: RoleCode.BUSINESS_CLERK, departmentId: 'a' }]))).toEqual(['a']);
  });
  it('管理员和主管不能扩大业务侧部门', () => {
    expect(businessDepartments(actor([{ role: RoleCode.ADMIN, departmentId: null }, { role: RoleCode.QC_SUPERVISOR, departmentId: null }, { role: RoleCode.SALES, departmentId: 'a' }]))).toEqual(['a']);
  });
});
