import { withDemoBoundary } from '@/components/DemoContextBar';
import Taro from '@tarojs/taro';
import ProfileView from '@/components/ProfileView';
import { currentMe } from '@/lib/auth';
import { homeCapabilities } from '@/lib/home-workspace';
import { scanRoll } from '@/lib/scan';
function Me() {
 const me=currentMe(); const roles=me?.roles.map(r=>r.role)??[]; const c=homeCapabilities(roles);
 return <ProfileView person={{name:me?.name??'',employeeNo:me?.employeeNo??'',department:me?.department?.name??'',roles}}
 onOpen={url=>void Taro.navigateTo({url})} onNavigate={page=>{
  if(page==='me')return;
  if(page==='scan'){if(c.inspector)void scanRoll();return;}
  if(page==='home'){void Taro.reLaunch({url:'/pages/index/index'});return;}
  void Taro.redirectTo({url:page==='tasks'?(c.businessOnly?'/pages/business/index':'/pages/tasks/index'):'/pages/notifications/index'});
 }}/ >;
}

export default withDemoBoundary(Me);
