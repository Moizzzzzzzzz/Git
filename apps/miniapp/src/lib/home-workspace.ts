import type { RoleCode } from '@fabricqc/shared';

/** Display capabilities only; the server remains the authority for every operation. */
export function homeCapabilities(roles: readonly RoleCode[]) {
  const has = (...values: RoleCode[]) => values.some(role => roles.includes(role));
  const inspector = has('INSPECTOR');
  const reviewer = has('QC_SUPERVISOR', 'QUALITY_MANAGER');
  const business = has('SALES', 'BUSINESS_MANAGER', 'BUSINESS_CLERK');
  const admin = has('ADMIN');
  return { inspector, reviewer, business, admin, sales: has('SALES'),
    qcTasks: inspector || reviewer || admin,
    businessOnly: business && !inspector && !reviewer && !admin,
    title: reviewer ? (has('QC_SUPERVISOR') ? '质检主管工作台' : '质量经理工作台')
      : inspector ? '质检员工作台' : admin ? '系统管理工作台'
      : has('SALES') ? '业务员工作台' : has('BUSINESS_MANAGER') ? '部门经理工作台' : '内勤工作台',
  };
}
