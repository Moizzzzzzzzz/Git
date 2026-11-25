import { installFixture } from './fixtures';
describe('fixture installation',()=>{
  it('never creates a task when an earlier attempt is uncertain',async()=>{
    const driver={read:jest.fn().mockResolvedValue({phase:'creating'}),write:jest.fn(),create:jest.fn(),advance:jest.fn(),verify:jest.fn()};
    await expect(installFixture(driver,'UNASSIGNED')).rejects.toThrow('待人工');
    expect(driver.create).not.toHaveBeenCalled();
  });
  it('does not replay an existing validated fixture',async()=>{
    const driver={read:jest.fn().mockResolvedValue({phase:'done',taskId:'isolated-id',taskNo:'T001'}),write:jest.fn(),create:jest.fn(),advance:jest.fn(),verify:jest.fn().mockResolvedValue(true)};
    await expect(installFixture(driver,'UNASSIGNED')).resolves.toBe('already-installed');
    expect(driver.create).not.toHaveBeenCalled();expect(driver.write).not.toHaveBeenCalled();
  });
  it('records intent before the create, id before completing, and verifies the result',async()=>{
    const calls:string[]=[];const driver={read:jest.fn().mockResolvedValue(null),write:jest.fn(async (x:{phase:string})=>{calls.push(x.phase)}),create:jest.fn(async()=>{calls.push('create');return {taskId:'isolated-id',taskNo:'T001'}}),advance:jest.fn(async()=>{calls.push('advance')}),verify:jest.fn(async()=>{calls.push('verify');return true})};
    await expect(installFixture(driver,'UNASSIGNED')).resolves.toBe('installed');
    expect(calls).toEqual(['creating','create','created','advancing','advance','verify','done']);
  });
  it('never marks an unverified fixture complete',async()=>{
    const driver={read:jest.fn().mockResolvedValue(null),write:jest.fn(),create:jest.fn().mockResolvedValue({taskId:'id',taskNo:'T002'}),advance:jest.fn(),verify:jest.fn().mockResolvedValue(false)};
    await expect(installFixture(driver,'UNASSIGNED')).rejects.toThrow('不一致');
    expect(driver.write).not.toHaveBeenCalledWith(expect.objectContaining({phase:'done'}));
  });
});

describe('fixture state plans',()=>{
  it('separates approval of a failed quality result from rejected review',()=>{
    const { fixturePlan } = require('./fixtures');
    expect(fixturePlan('DELIVERED_FAIL')).toEqual(['create','assign','register','inspect-fail','submit','review-approve','deliver']);
    expect(fixturePlan('RETURNED')).toEqual(['create','assign','register','inspect-pass','submit','review-return']);
    expect(fixturePlan('FINAL_PENDING')).toEqual(['create','assign','register','inspect-pass','submit','review-approve']);
  });
});

describe('service fixture adapter',()=>{
  it('creates the other-department fixture with the dedicated seed actor, not a switchable persona', async()=>{
    const {createServiceFixtureDriver}=require('./fixtures');
    const tasks={createBusiness:jest.fn().mockResolvedValue({id:'task-id',taskNo:'generated'})};
    const actors={sales:{userId:'sales'},other:{userId:'other'},supervisor:{userId:'supervisor'},inspector:{userId:'inspector'}};
    const store={read:jest.fn(),write:jest.fn()};
    const driver=createServiceFixtureDriver({tasks,actors,store,base:{businessDepartmentId:'dept2',otherDepartmentId:'dept1',templateId:'template',standardId:'standard',fabricId:'fabric'}});
    await expect(driver.create('OTHER_DEPT')).resolves.toEqual({taskId:'task-id',taskNo:'generated'});
    expect(tasks.createBusiness).toHaveBeenCalledWith(actors.other,expect.objectContaining({businessDepartmentId:'dept1',plannedRollCount:1}),expect.anything());
  });
});

it('rejects foreign checkpoint data before executing fixture actions',async()=>{
  const {createPrismaFixtureStore}=require('./fixtures');
  const prisma={systemSetting:{findUnique:jest.fn().mockResolvedValue({value:{environmentId:'production',resetVersion:'v1',phase:'done',taskId:'x'}})}};
  await expect(createPrismaFixtureStore(prisma,'UNASSIGNED').read()).rejects.toThrow('标记');
});

it('uses actual services and different actors to approve and deliver a failed-quality demo',async()=>{
  const {createServiceFixtureDriver}=require('./fixtures');
  const tasks={assignBusiness:jest.fn(),registerBusinessRolls:jest.fn().mockResolvedValue({items:[{taskRollId:'tr'}]}),confirmDelivery:jest.fn()};
  const inspections={start:jest.fn().mockResolvedValue({id:'ins'}),saveDraft:jest.fn().mockResolvedValue({draftVersion:1}),submit:jest.fn().mockResolvedValue({revision:1})};
  const reviews={decide:jest.fn()};const actors={sales:{userId:'sales'},other:{userId:'other'},supervisor:{userId:'supervisor'},inspector:{userId:'inspector'}};
  const ctx={tasks,inspections,reviews,actors,base:{businessDepartmentId:'d2',otherDepartmentId:'d1',templateId:'t',standardId:'s',fabricId:'f'},store:{read:jest.fn(),write:jest.fn()},uploadDemoPhoto:jest.fn().mockResolvedValue('media')};
  await createServiceFixtureDriver(ctx).advance('DELIVERED_FAIL','task');
  expect(inspections.saveDraft).toHaveBeenCalledWith(actors.inspector,'ins',expect.objectContaining({checklist:expect.arrayContaining([expect.objectContaining({key:'label_match',status:'NG'})])}),expect.anything());
  expect(reviews.decide).toHaveBeenCalledWith(actors.supervisor,'ins',expect.objectContaining({decision:'APPROVE'}),expect.anything());
  expect(tasks.confirmDelivery).toHaveBeenCalledWith(actors.supervisor,'task',expect.anything());
});

it('records task number before a later service failure and never marks it done',async()=>{
 const calls:unknown[]=[];const driver={read:jest.fn().mockResolvedValue(null),write:jest.fn(async(x:unknown)=>{calls.push(x)}),create:jest.fn().mockResolvedValue({taskId:'internal-id',taskNo:'server-task-no'}),advance:jest.fn().mockRejectedValue(new Error('network lost')),verify:jest.fn()};
 await expect(installFixture(driver,'PENDING_REVIEW')).rejects.toThrow('network lost');
 expect(calls).toEqual([{phase:'creating'},{phase:'created',taskId:'internal-id',taskNo:'server-task-no'},{phase:'advancing',taskId:'internal-id',taskNo:'server-task-no'}]);
 expect(driver.verify).not.toHaveBeenCalled();
});
