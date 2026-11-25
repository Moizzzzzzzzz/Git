import { RoleCode } from '@fabricqc/shared';
import { VcansOrdersService } from './vcans-orders.service';
import type { Actor } from '../common/actor';

const actor: Actor = { userId: 'user', name: 'user', employeeNo: 'user', departmentId: 'a', roles: [{ role: RoleCode.BUSINESS_MANAGER, departmentId: 'a' }], sessionId: 's', clientType: 'ADMIN_WEB' };
const data = { hNo: 'H1', businessDepartmentId: 'b', supervisorId: 'sup', plan: { mode: 'FULL' as const }, lines: [{}] };

describe('H订单授权', () => {
  it('跨部门建单在读取或写入数据库前拒绝', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new VcansOrdersService(prisma as never);
    await expect(service.create(actor, data)).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('本部门建单保留不同明细并记录操作者', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'order', hNo: 'H1', version: 0 });
    const change = jest.fn().mockResolvedValue({});
    const tx = { user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', roles: [{ role: { code: 'QC_SUPERVISOR' } }] }) }, vcansOrder: { create }, vcansOrderChange: { create: change }, notification: { create: jest.fn().mockResolvedValue({}) } };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
    const service = new VcansOrdersService(prisma as never);
    await service.create(actor, { ...data, businessDepartmentId: 'a', requiredStandardMode: 'FACTORY', lines: [{ customerOrderNo: 'P1' }, { customerOrderNo: 'P2' }] });
    expect(create.mock.calls[0][0].data).toMatchObject({ hNo: 'H1', createdById: 'user', lines: { create: [{ lineNo: 1, customerOrderNo: 'P1' }, { lineNo: 2, customerOrderNo: 'P2' }] } });
    expect(change).toHaveBeenCalled();
  });
  it('建单选项只查询明确授权的业务部门', async () => {
    const department = { findMany: jest.fn().mockResolvedValue([{ id: 'a', name: '部门A' }]) };
    const user = { findMany: jest.fn().mockResolvedValue([]) };
    const qualityStandard = { findMany: jest.fn().mockResolvedValue([]) };
    const inspectionTemplate = { findMany: jest.fn().mockResolvedValue([]) };
    const service = new VcansOrdersService({ department, user, qualityStandard, inspectionTemplate } as never);
    const result = await service.options(actor);
    expect(department.findMany.mock.calls[0][0].where.id.in).toEqual(['a']);
    expect(result.departments).toEqual([{ id: 'a', name: '部门A' }]);
    expect(result.standards).toEqual([]);
    expect(result.templates).toEqual([]);
  });
  it('业务列表只查询授权部门且不泄露检验明细', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'o', hNo: 'H1', businessDepartmentId: 'a', taskId: null, version: 0, arrivalComplete: false, planMode: 'FULL', createdAt: new Date(0), lines: [], assignedInspectorId: null, confirmedAt: null }]);
    const service = new VcansOrdersService({ vcansOrder: { findMany } } as never);
    const result = await service.list(actor);
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ businessDepartmentId: { in: ['a'] } }]);
    expect(result.items[0]).toMatchObject({ id: 'o', hNo: 'H1', status: 'UNASSIGNED', progress: { totalRolls: 0, originalRequired: 0 } });
    expect(result.items[0]).not.toHaveProperty('inspections');
  });
  it('跨部门订单详情不能读取', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'o', businessDepartmentId: 'b', supervisorId: 's', assignedInspectorId: null, lines: [] });
    const service = new VcansOrdersService({ vcansOrder: { findUnique } } as never);
    await expect(service.detail(actor, 'o')).rejects.toThrow();
  });
  it('非指定主管不能分发', async () => {
    const tx = { $queryRaw: jest.fn(), vcansOrder: { findUnique: jest.fn().mockResolvedValue({ id: 'o', supervisorId: 'someone-else', version: 0 }) } };
    const service = new VcansOrdersService({ $transaction: jest.fn((fn) => fn(tx)) } as never);
    await expect(service.assign(actor, 'o', { assigneeId: 'inspector', version: 0 })).rejects.toThrow();
  });
  it('质检主管只能按指定主管查看订单列表', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new VcansOrdersService({ vcansOrder: { findMany } } as never);
    await service.list({ ...actor, roles: [{ role: RoleCode.QC_SUPERVISOR, departmentId: 'qc' }] });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ supervisorId: 'user' }]);
  });
  it('分发候选仅指定主管可取', async () => {
    const findUnique = jest.fn().mockResolvedValue({ supervisorId: 'other' });
    const findMany = jest.fn();
    const service = new VcansOrdersService({ vcansOrder: { findUnique }, user: { findMany } } as never);
    await expect(service.assignmentOptions(actor, 'o')).rejects.toThrow();
    expect(findMany).not.toHaveBeenCalled();
  });
  it('搜索保持权限范围并匹配客户、面料、客户单号和H号', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new VcansOrdersService({ vcansOrder: { findMany } } as never);
    await service.list(actor, '  po-test  ');
    const where=findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toMatchObject({ OR: [{ businessDepartmentId: { in: ['a'] } }],purpose:{not:'TEST'} });
    expect(where.AND[1].OR).toEqual(expect.arrayContaining([
      {hNo:{contains:'po-test',mode:'insensitive'}},
      {lines:{some:{customerOrderNo:{contains:'po-test',mode:'insensitive'}}}},
      {lines:{some:{productName:{contains:'po-test',mode:'insensitive'}}}},
      {lines:{some:{productCode:{contains:'po-test',mode:'insensitive'}}}},
      {customer:{is:{name:{contains:'po-test',mode:'insensitive'}}}},
      {customer:{is:{code:{contains:'po-test',mode:'insensitive'}}}},
      {customerId:null,source:'VCANS',lines:{some:{sourceSnapshot:{path:['normalized','customerName'],string_contains:'po-test',mode:'insensitive'}}}},
    ]));
  });
});
