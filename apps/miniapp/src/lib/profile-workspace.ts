import type { RoleCode } from '@fabricqc/shared';
import { homeCapabilities } from './home-workspace';
export interface ProfileAction { id: 'business' | 'tasks' | 'reviews' | 'messages'; label: string; url: string }
export function profileActions(roles: readonly RoleCode[]): ProfileAction[] {
  const c=homeCapabilities(roles);
  const items: ProfileAction[]=[];
  if(c.business) items.push({id:'business',label:'本部门订单',url:'/pages/orders/list'});
  if(c.qcTasks) items.push({id:'tasks',label:c.inspector?'我的验布任务':c.reviewer?'任务工作区':'验布任务',url:'/pages/tasks/index'});
  if(c.reviewer) items.push({id:'reviews',label:'审核中心',url:'/pages/review/list'});
  items.push({id:'messages',label:'消息中心',url:'/pages/notifications/index'});
  return items;
}
export function logoutConfirmation(unsynced: number) {
  return unsynced ? `本机还有 ${unsynced} 条未同步的检验数据，退出后仍保留在本机，重新登录可继续同步。` : '退出后需要重新进入小程序登录';
}
