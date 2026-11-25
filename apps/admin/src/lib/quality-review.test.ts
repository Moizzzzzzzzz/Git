import {describe,expect,it} from 'vitest';
import {qualityReviewInput,type QualityReviewFields} from './quality-review';
const required:QualityReviewFields={reviewEligibility:{required:true,allowed:true,canApprovePass:true,reasons:[{code:'SCORE',message:'评分超过标准'}]}};
describe('explicit supervisor quality review',()=>{
 it('leaves old records on the original audit protocol',()=>{expect(qualityReviewInput({},'APPROVE','','')).toEqual({});expect(()=>qualityReviewInput({},'APPROVE','PASS','已核实')).toThrow('权限');});
 it('requires an explicit final result and a paired reason',()=>{expect(()=>qualityReviewInput(required,'APPROVE','','')).toThrow('质量结论');expect(()=>qualityReviewInput(required,'APPROVE','PASS','  ')).toThrow('原因');});
 it('retains the supervisor reason without rewriting the system outcome',()=>{const record={...required,systemResult:'FAIL' as const,systemReasons:['原分超限'],normalizedScore:41};expect(qualityReviewInput(record,'APPROVE','PASS',' 已核实客户接收要求 ')).toEqual({finalResult:'PASS',finalReason:'已核实客户接收要求'});expect(record.systemResult).toBe('FAIL');expect(record.normalizedScore).toBe(41);});
 it('supports a reviewed fail independently from approval',()=>{expect(qualityReviewInput(required,'APPROVE','FAIL','核实疵点影响使用')).toEqual({finalResult:'FAIL',finalReason:'核实疵点影响使用'});});
 it('does not infer review permission from a required flag',()=>{const denied={reviewEligibility:{required:true,allowed:false,reasons:[]}};expect(()=>qualityReviewInput(denied,'APPROVE','PASS','原因')).toThrow('不能');});
 it('keeps return/reject actions available without submitting a quality override',()=>{expect(qualityReviewInput(required,'RETURN','PASS','旧选择')).toEqual({});expect(qualityReviewInput(required,'REJECT','FAIL','旧选择')).toEqual({});});
 it('leaves optional reviews unchanged or rejects unauthorized overrides',()=>{const v={reviewEligibility:{required:false,allowed:false,reasons:[]}};expect(qualityReviewInput(v,'APPROVE','','')).toEqual({});expect(()=>qualityReviewInput(v,'APPROVE','PASS','原因')).toThrow('不允许');});
});

it('limits the trimmed final reason to the API contract',()=>{expect(()=>qualityReviewInput(required,'APPROVE','PASS','原'.repeat(1001))).toThrow('1000');expect(qualityReviewInput(required,'APPROVE','PASS','原'.repeat(1000)).finalReason?.length).toBe(1000);});

it('hard failures allow a final fail but never a pass, and missing pass capability is not inferred',()=>{for(const canApprovePass of [false,undefined]){const record={reviewEligibility:{required:true,allowed:true,canApprovePass,reasons:[{code:'HARD_FAIL',message:'硬性失败'}]}};expect(()=>qualityReviewInput(record,'APPROVE','PASS','希望接收')).toThrow('不允许复核为合格');expect(qualityReviewInput(record,'APPROVE','FAIL','核实失败')).toEqual({finalResult:'FAIL',finalReason:'核实失败'});}});
