import { Button, Image, Text, View } from '@tarojs/components';
import { ROLE_LABELS, type RoleCode } from '@fabricqc/shared';
import { profileActions } from '@/lib/profile-workspace';
import { homeCapabilities } from '@/lib/home-workspace';
import taskIcon from '@/assets/icons/task.png';
import reviewIcon from '@/assets/icons/review.png';
import messageIcon from '@/assets/icons/message.png';
import WorkspaceNav, { type WorkspacePage } from './WorkspaceNav';
import '../pages/me/index.scss';
export interface ProfileIdentity { name: string; department: string; employeeNo: string; roles: RoleCode[] }
export default function ProfileView({person,onOpen,onNavigate}:{person:ProfileIdentity;onOpen:(url:string)=>void;onNavigate:(page:WorkspacePage)=>void}) {
 const actions=profileActions(person.roles);
 return <View className="container me-page">
  <View className="me-heading"><Text className="me-heading-title">我的</Text><Text className="me-heading-sub">永盛集团质检平台</Text></View>
  <View className="me-profile"><View className="me-avatar">{person.name.slice(0,1)||'员'}</View><View className="me-person"><View className="me-name">{person.name||'员工'}</View><View className="me-role">{person.roles.map(r=>ROLE_LABELS[r]).join(' · ')}</View><View className="me-meta">{person.department||'未设置部门'}</View></View></View>
  <View className="card me-functions"><View className="card-title">常用功能</View><View className="me-grid">{actions.map(a=><Button className="me-function" key={a.id} onClick={()=>onOpen(a.url)}><Image className="theme-icon" src={a.id==='reviews'?reviewIcon:a.id==='messages'?messageIcon:taskIcon} mode="aspectFit"/><Text>{a.label}</Text></Button>)}</View></View>
  <Button className="me-settings" onClick={()=>onOpen('/pages/settings/index')}><View><View className="me-settings-title">设置</View><View className="muted">账号信息、微信提醒与本机数据</View></View><Text className="me-chevron">›</Text></Button>
  <WorkspaceNav current="me" canScan={homeCapabilities(person.roles).inspector} onNavigate={onNavigate}/>
 </View>;
}
