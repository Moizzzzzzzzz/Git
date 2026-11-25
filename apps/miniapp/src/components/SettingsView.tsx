import { Button, Text, View } from '@tarojs/components';
import { ROLE_LABELS } from '@fabricqc/shared';
import {reminderAllowances,type ReminderConfiguration} from '@/lib/reminder-allowances';
import { homeCapabilities } from '@/lib/home-workspace';
import type { ProfileIdentity } from './ProfileView';
import '../pages/settings/index.scss';
export interface SettingsViewProps { demo?:boolean;demoAccess?:boolean;demoError?:boolean; person:ProfileIdentity; configuration:ReminderConfiguration|null; subscriptionError:boolean; draftCount:number; unsynced:number; onRetry:()=>void; onOpen:(url:string)=>void; onLogout:()=>void }
export default function SettingsView(p:SettingsViewProps){
 const c=homeCapabilities(p.person.roles);
 const allowances=p.configuration?reminderAllowances(p.person.roles,p.configuration.templates,p.configuration.subscriptions):[];
 return <View className="container settings-page">
  <View className="settings-title">设置</View>
  <View className="card"><View className="card-title">账号信息</View><View className="kv"><Text className="k">员工编号</Text><Text>{p.person.employeeNo||'—'}</Text></View><View className="kv"><Text className="k">所属部门</Text><Text>{p.person.department||'未设置'}</Text></View><View className="settings-roles"><View className="label">账号角色与权限</View><View className="row-gap">{p.person.roles.map(r=><Text className="tag" key={r}>{ROLE_LABELS[r]}</Text>)}</View></View></View>
  {p.demoAccess&&<View className="card"><Button className="settings-link" onClick={()=>p.onOpen('/pages/demo/index')}>{p.demo?'切换演示身份':'演示身份'} ›</Button></View>}
  {p.demoError&&<View className="card"><View className="muted">演示权限暂时无法获取。</View><Button className="btn small secondary" onClick={p.onRetry}>重新获取</Button></View>}
  {p.demo?<View className="card"><View className="card-title">演示消息</View><View className="muted">消息仅保存在演示环境，不发送真实微信，也不使用本人订阅次数。</View></View>:<View className="card"><View className="card-title">微信提醒</View>{p.subscriptionError?<View><View className="muted">提醒授权信息暂时无法获取。</View><Button className="btn small secondary settings-retry" onClick={p.onRetry}>重新获取</Button></View>:p.configuration===null?<View className="muted">正在获取提醒授权…</View>:allowances.length?<View>{allowances.map(a=><View className="kv" key={a.key}><Text className="k">{a.label}</Text><Text>{a.status}</Text></View>)}</View>:<View className="muted">当前岗位没有需要单独授权的提醒模板。</View>}

   {c.sales&&<Button className="settings-link" onClick={()=>p.onOpen('/pages/business/index')}>设置整单完成提醒 ›</Button>}
   {c.reviewer&&<Button className="settings-link" onClick={()=>p.onOpen('/pages/review/list')}>前往审核中心，接收审核提醒 ›</Button>}
   {!c.sales&&!c.reviewer&&<View className="muted settings-note">任务与审核消息可在消息中心查看。</View>}
  </View>}
  <View className="card"><View className="card-title">本机数据</View><View className="kv"><Text className="k">本机检验草稿</Text><Text>{p.draftCount} 条</Text></View><View className={p.unsynced?'warn-box':'muted'}>{p.unsynced?`其中 ${p.unsynced} 条含未同步记录或照片，请保留本机数据。`:'草稿保留在本机，不会因退出登录而删除。'}</View></View>
  <Button className="btn ghost settings-logout" onClick={p.onLogout}>{p.demo?'切回本人':'退出登录'}</Button>
 </View>;
}
