import { installBase } from './bootstrap';

describe('base install fail-safe coordination', () => {
  it('does not write when database guard rejects the environment', async () => {
    const store = { verify: jest.fn().mockRejectedValue(new Error('bad environment')), transaction: jest.fn() };
    await expect(installBase(store)).rejects.toThrow('bad environment');
    expect(store.transaction).not.toHaveBeenCalled();
  });
  it('skips an already installed matching manifest without writes', async () => {
    const tx = { readState: jest.fn().mockResolvedValue({ version:'v1', phase:'base-complete' }), validateExisting: jest.fn().mockResolvedValue(true), writeState: jest.fn(), createBase: jest.fn() };
    const store = { verify: jest.fn().mockResolvedValue(undefined), transaction: jest.fn(async (f: (tx: any)=>Promise<string>)=>f(tx)) };
    await expect(installBase(store)).resolves.toBe('already-installed');
    expect(tx.validateExisting).toHaveBeenCalled();
    expect(tx.writeState).not.toHaveBeenCalled();
    expect(tx.createBase).not.toHaveBeenCalled();
  });
  it('rejects inconsistent state without overwriting', async () => {
    const tx = { readState: jest.fn().mockResolvedValue({ version:'v1',phase:'base-complete' }), validateExisting: jest.fn().mockResolvedValue(false), writeState: jest.fn(), createBase: jest.fn() };
    const store = { verify: jest.fn().mockResolvedValue(undefined), transaction: jest.fn(async (f:(tx:any)=>Promise<string>)=>f(tx)) };
    await expect(installBase(store)).rejects.toThrow('不一致');
    expect(tx.writeState).not.toHaveBeenCalled();
  });
  it('refuses partially installed state instead of replaying creates', async () => {
    const tx = { readState: jest.fn().mockResolvedValue({version:'v1',phase:'in-progress'}),validateExisting:jest.fn(),writeState:jest.fn(),createBase:jest.fn() };
    const store = {verify:jest.fn().mockResolvedValue(undefined),transaction:jest.fn(async (f:(tx:any)=>Promise<string>)=>f(tx))};
    await expect(installBase(store)).rejects.toThrow('未完成');
    expect(tx.createBase).not.toHaveBeenCalled();
  });
  it('creates a fresh base once in the guarded transaction', async () => {
    const tx = {readState:jest.fn().mockResolvedValue(null),validateExisting:jest.fn(),checkNoConflicts:jest.fn().mockResolvedValue(true),createBase:jest.fn().mockResolvedValue(undefined),writeState:jest.fn().mockResolvedValue(undefined)};
    const store = {verify:jest.fn().mockResolvedValue(undefined),transaction:jest.fn(async (f:(tx:any)=>Promise<string>)=>f(tx))};
    await expect(installBase(store)).resolves.toBe('installed');
    expect(tx.createBase).toHaveBeenCalledTimes(1);
    expect(tx.writeState).toHaveBeenCalledWith({version:'v1',phase:'base-complete'});
  });
});

describe('Prisma adapter safety', () => {
  it('runs the verifier before opening a database transaction', async()=>{
    const { createPrismaDemoStore } = require('./bootstrap');
    const prisma = { $transaction: jest.fn() };
    const verifier = jest.fn().mockRejectedValue(new Error('bad isolation'));
    await expect(installBase(createPrismaDemoStore(prisma,verifier))).rejects.toThrow('bad isolation');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

it('compares stored JSON independent of PostgreSQL JSONB key order',()=>{
 const {sameSeedJson}=require('./bootstrap');
 expect(sameSeedJson({b:1,a:{y:2,x:3}},{a:{x:3,y:2},b:1})).toBe(true);
 expect(sameSeedJson({a:[1,2]},{a:[2,1]})).toBe(false);
});

it('creates all seven personas and the non-switchable seed actor in the base transaction',async()=>{
  const {createPrismaDemoStore}=require('./bootstrap');
  const userCreate=jest.fn().mockResolvedValue({});
  const tx={
    $queryRaw:jest.fn().mockResolvedValue([{locked:true}]),
    systemSetting:{findUnique:jest.fn().mockResolvedValue(null),create:jest.fn().mockResolvedValue({})},
    department:{count:jest.fn().mockResolvedValue(0),create:jest.fn().mockResolvedValue({})},
    user:{count:jest.fn().mockResolvedValue(0),create:userCreate},
    inspectionTemplate:{count:jest.fn().mockResolvedValue(0),create:jest.fn(async({data}:{data:{code:string}})=>({id:'tpl-'+data.code}))},
    qualityStandard:{count:jest.fn().mockResolvedValue(0),create:jest.fn(async({data}:{data:{code:string}})=>({id:'std-'+data.code}))},
    fabric:{count:jest.fn().mockResolvedValue(0),create:jest.fn().mockResolvedValue({})},
    defectType:{count:jest.fn().mockResolvedValue(0),create:jest.fn().mockResolvedValue({})},
    role:{findUnique:jest.fn(async({where}:{where:{code:string}})=>({id:'role-'+where.code}))},
    standardVersion:{create:jest.fn().mockResolvedValue({})},auditLog:{create:jest.fn().mockResolvedValue({})},
  };
  const prisma={$transaction:jest.fn(async(fn:(t:typeof tx)=>Promise<unknown>)=>fn(tx))};
  await expect(installBase(createPrismaDemoStore(prisma,jest.fn()))).resolves.toBe('installed');
  expect(userCreate).toHaveBeenCalledTimes(8);
  const entry=userCreate.mock.calls.map(([arg]:[{data:{employeeNo:string}}])=>arg.data).find((d:{employeeNo:string})=>d.employeeNo==='DEMO-SALES-01-SEED');
  expect(entry).toMatchObject({id:'b8374589-708e-4c16-893e-c46b7e07a243',departmentId:'fe31afc0-ad98-41a5-9b2e-e22325e58907',roles:{create:{roleId:'role-SALES',departmentId:'fe31afc0-ad98-41a5-9b2e-e22325e58907'}}});
  expect(entry).not.toHaveProperty('username');expect(entry).not.toHaveProperty('passwordHash');expect(entry).not.toHaveProperty('wechat');
  expect(tx.systemSetting.create).toHaveBeenCalledTimes(1);
});
