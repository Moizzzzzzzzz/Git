import {describe,expect,it} from 'vitest';
import {reminderAllowances} from '../src/lib/reminder-allowances';
import {taskRollAction} from '../src/lib/task-roll-action';
describe('role and reminder controls',()=>{
 it('keeps actual template quotas separate for mixed roles',()=>{
  expect(reminderAllowances(['SALES','INSPECTOR'],{reviewRequest:'rq',reviewResult:'rr',taskDelivered:'td'},[{templateId:'rr',remaining:5},{templateId:'td',remaining:1}])).toEqual([{key:'taskDelivered',label:'整单完成提醒',status:'可用 1 次'},{key:'reviewResult',label:'验布审核结果提醒',status:'可用 5 次'}]);
 });
 it('distinguishes unconfigured and not authorized without summing unrelated templates',()=>{
  expect(reminderAllowances(['SALES','QC_SUPERVISOR'],{reviewRequest:'rq',reviewResult:'rr',taskDelivered:null},[{templateId:'rr',remaining:9}]).map(x=>x.status)).toEqual(['模板未配置','尚未授权']);
 });
 it('does not grant inspector action to a supervisor or administrator',()=>{
  expect(taskRollAction(['QC_SUPERVISOR'],'me','other',null)).toBe('none');
  expect(taskRollAction(['ADMIN'],'me','other',null)).toBe('none');
  expect(taskRollAction(['QC_SUPERVISOR'],'me','other','inspection')).toBe('review');
 });
 it('only assigned inspectors start business rolls and preserves self review guard',()=>{
  expect(taskRollAction(['INSPECTOR'],'me','me',null)).toBe('inspect');
  expect(taskRollAction(['INSPECTOR'],'me','other',null)).toBe('none');
  expect(taskRollAction(['QC_SUPERVISOR','INSPECTOR'],'me','me','i')).toBe('inspect');
 });
});
