import { DEV_DEFAULT_FOUR_POINT_RULES, standardRulesSchema } from '@fabricqc/shared';
import { StandardsService } from './standards.service';
import type { Actor } from '../common/actor';

const rules=standardRulesSchema.parse({...DEV_DEFAULT_FOUR_POINT_RULES,applicability:{structure:['KNIT'],fiber:['NYLON']}});
const actor={userId:'u',roles:[]} as unknown as Actor;
const meta={} as never;
function harness(before?: Record<string, unknown>) {
 const tx={qualityStandard:{findUnique:jest.fn().mockResolvedValue({kind:'FOUR_POINT',versions:[]})},standardVersion:{create:jest.fn().mockImplementation(({data})=>Promise.resolve(data)),findUnique:jest.fn().mockResolvedValue(before),update:jest.fn().mockImplementation(({data})=>Promise.resolve(data))},defectType:{findMany:jest.fn().mockImplementation(({where})=>Promise.resolve(where.code.in.map((code:string)=>({code}))))}};
 const prisma={$transaction:async (fn:(x:typeof tx)=>unknown)=>fn(tx)};
 const svc=new StandardsService(prisma as never,{log:jest.fn().mockResolvedValue(undefined)} as never);
 return {svc,tx};
}
describe('测试标准版本保护',()=>{
 it('显式 TEST 创建标记测试，非 TEST 不接受新测试规则',async()=>{
  const {svc,tx}=harness();
  await expect(svc.createVersion(actor,'std',{purpose:'TEST',rules,notes:null},meta)).resolves.toMatchObject({isDevDefault:true});
  expect(tx.standardVersion.create).toHaveBeenCalledTimes(1);
  await expect(svc.createVersion(actor,'std',{rules,notes:null},meta)).rejects.toThrow('必须明确指定 TEST');
 });
 it('测试草稿不能经旧编辑器清标，也不能覆盖丢失适用范围',async()=>{
  const {svc}=harness({status:'DRAFT',isDevDefault:true,rules,standard:{kind:'FOUR_POINT'}});
  await expect(svc.updateVersion(actor,'v',{rules,notes:null},meta)).rejects.toThrow('TEST 路径');
  const old=standardRulesSchema.parse(DEV_DEFAULT_FOUR_POINT_RULES);
  await expect(svc.updateVersion(actor,'v',{purpose:'TEST',rules:old,notes:null},meta)).rejects.toThrow('旧编辑器覆盖');
 });
});
