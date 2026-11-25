import { businessHomeFlags } from './business-home';
import { TasksService } from './tasks.service';
import { RoleCode } from '@fabricqc/shared';
import type { Actor } from '../common/actor';

const base = {status:'OPEN', delivered:false, assigned:true, hasSupervisor:true, planned:2};
describe('业务首页进度条件', () => {
  it('区分待逐卷审核、退回和全部审核通过', () => {
    expect(businessHomeFlags({...base,statuses:['SUBMITTED',null]})).toEqual({finalConfirmationReady:false,canRemind:true});
    expect(businessHomeFlags({...base,statuses:['APPROVED','REJECTED']})).toEqual({finalConfirmationReady:false,canRemind:false});
    expect(businessHomeFlags({...base,statuses:['APPROVED','APPROVED']})).toEqual({finalConfirmationReady:true,canRemind:true});
  });
  it('取消、已交付、无主管或未分发分别阻止相应操作', () => {
    const statuses = ['APPROVED','APPROVED'];
    expect(businessHomeFlags({...base,status:'CANCELLED',statuses})).toEqual({finalConfirmationReady:false,canRemind:false});
    expect(businessHomeFlags({...base,delivered:true,statuses})).toEqual({finalConfirmationReady:false,canRemind:false});
    expect(businessHomeFlags({...base,hasSupervisor:false,statuses}).canRemind).toBe(false);
    expect(businessHomeFlags({...base,assigned:false,statuses}).finalConfirmationReady).toBe(false);
    expect(businessHomeFlags({...base,statuses:[]})).toEqual({finalConfirmationReady:false,canRemind:false});
  });
});
describe('业务首页列表合同', () => {
  const actor = (roles: Actor['roles']): Actor => ({userId:'u',name:'n',employeeNo:'n',departmentId:'a',roles,sessionId:'s',clientType:'ADMIN_WEB'});
  it('仅查询授权部门、稳定排序，不返回逐卷详情', async () => {
    const findMany = jest.fn().mockResolvedValue([{id:'task',taskNo:'T1',title:'任务',businessDepartmentId:'a',plannedRollCount:1,assigneeId:'i',supervisorId:'s',supervisor:{id:'s',name:'主管'},createdById:'u',status:'OPEN',createdAt:new Date('2026-01-01T00:00:00Z'),delivery:null,rolls:[{inspections:[{status:'APPROVED',revision:1}]}]}]);
    const svc = new TasksService({qcTask:{findMany}} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await svc.listBusiness(actor([{role:RoleCode.SALES,departmentId:'a'},{role:RoleCode.ADMIN,departmentId:null}]));
    expect(findMany.mock.calls[0][0].where).toEqual({origin:'BUSINESS',businessDepartmentId:{in:['a']},vcansOrder:null});
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{createdAt:'desc'},{id:'desc'}]);
    expect(result.items[0]).toMatchObject({supervisor:{id:'s',name:'主管'},finalConfirmationReady:true,canRemind:true,status:'OPEN'});
    expect(result.items[0]).not.toHaveProperty('rolls');
    expect(result.items[0]).not.toHaveProperty('inspection');
  });
  it('无授权部门不查询、返回空列表', async () => {
    const findMany = jest.fn();
    const svc = new TasksService({qcTask:{findMany}} as never, {} as never, {} as never, {} as never, {} as never);
    expect(await svc.listBusiness(actor([{role:RoleCode.ADMIN,departmentId:null}]))).toEqual({items:[]});
    expect(findMany).not.toHaveBeenCalled();
  });
});
