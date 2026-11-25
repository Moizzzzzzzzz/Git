import { Image, Text, View } from '@tarojs/components';
import home from '@/assets/icons/home.png';
import homeMuted from '@/assets/icons/home-muted.png';
import task from '@/assets/icons/task.png';
import taskMuted from '@/assets/icons/task-muted.png';
import scan from '@/assets/icons/scan-muted.png';
import message from '@/assets/icons/message.png';
import messageMuted from '@/assets/icons/message-muted.png';
import user from '@/assets/icons/user.png';
import userMuted from '@/assets/icons/user-muted.png';
import './BottomNav.scss';
export type WorkspacePage = 'home' | 'tasks' | 'messages' | 'me' | 'scan';
export default function WorkspaceNav({ current, canScan, onNavigate }: { current: WorkspacePage; canScan: boolean; onNavigate: (page: WorkspacePage) => void }) {
  const items: { id: WorkspacePage; label: string; icon: string; selected: string }[] = [
    {id:'home',label:'首页',icon:homeMuted,selected:home},
    {id:'tasks',label:'任务',icon:taskMuted,selected:task},
    ...(canScan ? [{id:'scan' as const,label:'扫码',icon:scan,selected:scan}] : []),
    {id:'messages',label:'消息',icon:messageMuted,selected:message},
    {id:'me',label:'我的',icon:userMuted,selected:user},
  ];
  return <View className="bottom-nav">{items.map(item=><View key={item.id} className={`nav-item ${current===item.id?'active':''}`} onClick={()=>onNavigate(item.id)}><Image className="theme-icon" src={current===item.id?item.selected:item.icon} mode="aspectFit"/><Text>{item.label}</Text></View>)}</View>;
}
