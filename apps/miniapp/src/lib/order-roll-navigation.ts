import Taro from '@tarojs/taro';
import {openTaskRoll} from './scan';
import type {OrderRoll} from './orders';
/** H-only routing. The existing start endpoint creates or resumes the actual inspection. */
export async function openOrderRoll(roll:OrderRoll,taskId:string,tasks:Parameters<typeof openTaskRoll>[1]){
 const current=tasks.find(t=>t.task.id===taskId);
 if(!current)throw new Error('当前没有分配给你的验布任务，请刷新订单');
 const pendingAdditional=roll.selections?.some(s=>s.kind==='ADDITIONAL'&&s.inspectionId===null)===true;
 const active=current.inspection&&['DRAFT','RETURNED','SUBMITTED'].includes(current.inspection.status);
 if(pendingAdditional&&!active){
  if(current.status!=='PENDING')throw new Error('追加检验状态已变化，请刷新订单后重试');
  await Taro.navigateTo({url:`/pages/start/index?taskRollId=${encodeURIComponent(current.taskRollId)}&rollNo=${encodeURIComponent(roll.rollNo??roll.roll?.rollNo??'')}&mode=${current.task.defaultMode??''}&scope=${current.task.defaultScope}`});
  return;
 }
 await openTaskRoll(roll.rollNo??roll.roll?.rollNo??'', [current]);
}
