import { describe, expect, it } from 'vitest';
import { homeCapabilities } from '../src/lib/home-workspace';
describe('homepage capabilities follow existing roles',()=>{
 it('does not grant inspector or reviewer actions to a pure administrator',()=>{
  expect(homeCapabilities(['ADMIN'])).toMatchObject({admin:true,qcTasks:true,inspector:false,reviewer:false,business:false});
 });
 it.each(['SALES','BUSINESS_MANAGER','BUSINESS_CLERK'] as const)('keeps %s in its business workspace',role=>{
  expect(homeCapabilities([role])).toMatchObject({businessOnly:true,inspector:false,reviewer:false,sales:role==='SALES'});
 });
 it.each(['QC_SUPERVISOR','QUALITY_MANAGER'] as const)('does not grant scanning to %s',role=>{
  expect(homeCapabilities([role])).toMatchObject({reviewer:true,inspector:false,qcTasks:true});
 });
 it('preserves both capabilities of inspector/supervisor and business/inspector combinations',()=>{
  expect(homeCapabilities(['INSPECTOR','QC_SUPERVISOR'])).toMatchObject({inspector:true,reviewer:true});
  expect(homeCapabilities(['INSPECTOR','SALES'])).toMatchObject({inspector:true,business:true,sales:true,businessOnly:false});
 });
});
