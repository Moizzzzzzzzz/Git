import { describe, expect, it } from 'vitest';
import { canRemindTask, parseRollNumbers } from '../src/lib/business-workflow';
describe('mobile business progress', () => {
 it('uses current server qualification for partial submissions and final confirmation',()=>{
  expect(canRemindTask({status:'IN_PROGRESS',delivered:false,canRemind:true})).toBe(true);
  expect(canRemindTask({status:'IN_PROGRESS',delivered:false,canRemind:false})).toBe(false);
 });
 it('fails closed for cancelled, delivered, REJECTED qualification and old responses',()=>{
  expect(canRemindTask({status:'CANCELLED',delivered:false,canRemind:true})).toBe(false);
  expect(canRemindTask({status:'IN_PROGRESS',delivered:true,canRemind:true})).toBe(false);
  expect(canRemindTask({status:'IN_PROGRESS',delivered:false,canRemind:false})).toBe(false);
  expect(canRemindTask({delivered:false})).toBe(false);
 });
 it('keeps all unique human entered roll numbers and rejects duplicates',()=>{
  expect(parseRollNumbers('001\n002')).toEqual(['001','002']);
  expect(()=>parseRollNumbers('001,001')).toThrow('重复');
 });
});
