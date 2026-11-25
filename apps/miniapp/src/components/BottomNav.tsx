import Taro from '@tarojs/taro';
import { currentMe, hasRole } from '@/lib/auth';
import { homeCapabilities } from '@/lib/home-workspace';
import { scanRoll } from '@/lib/scan';
import WorkspaceNav, { type WorkspacePage } from './WorkspaceNav';
export default function BottomNav({ current }: { current: Exclude<WorkspacePage, 'scan'> }) {
  const capabilities=homeCapabilities(currentMe()?.roles.map(r=>r.role)??[]);
  function go(page: WorkspacePage) {
    if (current===page) return;
    if (page==='scan') { if(hasRole('INSPECTOR')) void scanRoll(); return; }
    const url={home:'/pages/index/index',tasks:capabilities.businessOnly?'/pages/orders/list':'/pages/tasks/index',messages:'/pages/notifications/index',me:'/pages/me/index'}[page];
    if(page==='home') { void Taro.reLaunch({url}); return; }
    if(current==='home') void Taro.navigateTo({url}); else void Taro.redirectTo({url});
  }
  return <WorkspaceNav current={current} canScan={capabilities.inspector} onNavigate={go}/>;
}
