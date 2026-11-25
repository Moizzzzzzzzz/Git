import { DemoActorService } from './demo-actor.service';
describe('演示主体加载',()=>{
 it('只接受固定actor及固定角色范围',async()=>{
  const user={id:'13943a7e-f52a-4824-984c-1771fefbd6a4',name:'demo',employeeNo:'DEMO-SALES',status:'ACTIVE',departmentId:'47596d40-dd4a-4ca8-ab14-28e96be0489d',roles:[{departmentId:'47596d40-dd4a-4ca8-ab14-28e96be0489d',role:{code:'SALES'}}]};
  const svc=new DemoActorService({user:{findUnique:jest.fn().mockResolvedValue(user)}} as never);
  expect((await svc.load('p01','sid')).roles).toEqual([{role:'SALES',departmentId:user.departmentId}]);
  user.roles.push({departmentId:user.departmentId,role:{code:'ADMIN'}});
  await expect(svc.load('p01','sid')).rejects.toThrow();
 });
});
