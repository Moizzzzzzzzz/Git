import { Button, Image, Text, View } from '@tarojs/components';
import { ROLE_LABELS, type RoleCode } from '@fabricqc/shared';
import { homeCapabilities } from '@/lib/home-workspace';
import draftIcon from '@/assets/icons/draft.png';
import reviewIcon from '@/assets/icons/review.png';
import taskIcon from '@/assets/icons/task.png';
import plusIcon from '@/assets/icons/plus.png';
import WorkspaceNav, { type WorkspacePage } from './WorkspaceNav';
import '../pages/index/index.scss';
export type HomeAction = 'scan' | 'create' | 'business' | 'tasks' | 'reviews' | 'external' | 'drafts' | 'me';
export interface HomeTask { id: string; taskNo: string; title: string; rollCount: number; doneCount: number; pendingCount: number; dueAt: string | null }
export interface HomeDraft { id: string; savedAt: string; dirty: boolean }
export interface HomeViewProps {
  name: string; department: string; roles: RoleCode[]; today: number | null; pendingReviews: number | null;
  tasksLoaded?: boolean; tasks: HomeTask[]; drafts: HomeDraft[]; unsynced: number; error: string; showDrafts: boolean;
  onAction: (action: HomeAction) => void; onNavigate: (page: WorkspacePage) => void;
  onTask: (id: string) => void; onDraft: (id: string) => void;
}
/** Pure presentation shared by the real session container and the isolated visual review. */
export default function HomeView(p: HomeViewProps) {
  const c=homeCapabilities(p.roles);
  const primary: {title:string;description:string;label:string;action:HomeAction} = c.reviewer
    ? {title:'待审记录',description:'核对验布记录，确认结果准确后完成审核。',label:'进入审核中心',action:'reviews'}
    : c.inspector ? {title:'现场验布',description:'按任务验布、记录疵点，完成后提交主管审核。',label:'扫码开始验布',action:'scan'}
    : c.sales ? {title:'任务布置',description:'指定质检主管与计划卷数，跟进任务进度。',label:'布置验布任务',action:'create'}
    : c.business ? {title:'本部门进度',description:'查看任务分发与已验卷数，整单确认后查看结果。',label:'查看本部门任务',action:'business'}
    : {title:'任务与协作',description:'查看验布任务与工作消息，人员和标准配置请使用网页管理端。',label:'查看验布任务',action:'tasks'};
  const actions: {id:HomeAction;title:string;description:string;icon:string}[]=[];
  if(c.business) actions.push({id:'business',title:'本部门任务',description:c.sales?'查看进度 · 催主管审核':'查看进度 · 整单结果',icon:taskIcon});
  if(c.sales && !c.businessOnly) actions.push({id:'create',title:'布置验布任务',description:'提交给指定质检主管',icon:plusIcon});
  if(c.qcTasks) actions.push({id:'tasks',title:c.reviewer?'任务工作区':c.inspector?'我的验布任务':'验布任务',description:c.reviewer?'分发与跟进 · 按授权处理':c.inspector?'查看待验任务与布卷':'查看任务与执行进度',icon:taskIcon});
  if(c.inspector) actions.push({id:'external',title:'外厂自建验布',description:'无内部二维码时登记验布',icon:plusIcon},{id:'drafts',title:'本机草稿',description:'继续未完成的验布记录',icon:draftIcon});
  if(c.reviewer && c.inspector) actions.push({id:'reviews',title:'审核中心',description:'确认记录 · 不可审核本人提交',icon:reviewIcon});
  const workflowNote=c.business?'整单经主管确认后开放检验结果与照片。审核确认表示记录准确，不代表布料全部合格。':c.reviewer?'审核确认记录准确。整单确认由指定主管完成，不合格布料的判定仍保留。':c.inspector?'验布记录提交后由主管审核。未同步的草稿保存在本机，请勿清除本机数据。':'系统管理员权限不包含验布与审核；如兼任其他岗位，将显示对应工作入口。';
  return <View className="workspace">
    <View className="workspace-brand"><View className="workspace-mark">永</View><Text>永盛集团质检平台</Text><Text className="workspace-brand-caption">工作空间</Text></View>
    <View className="workspace-heading"><View className="workspace-person"><View className="workspace-eyebrow">{p.department || '永盛集团'}</View><View className="workspace-title">{c.title}</View><View className="workspace-subtitle">{p.name} · {p.roles.map(r=>ROLE_LABELS[r]).join(' / ')}</View></View><View className="workspace-avatar" onClick={()=>p.onAction('me')}>{p.name.slice(0,1)||'员'}</View></View>
    {p.error&&<View className="error-box">数据加载不完整：{p.error}</View>}
    {p.unsynced>0&&<View className="warn-box">本机有 {p.unsynced} 条验布记录待同步，请检查草稿。</View>}
    <View className="workspace-focus"><View className="workspace-focus-tag">{c.reviewer?'审核待办':c.inspector?'现场验布':c.sales?'任务协同':c.business?'部门进度':'管理协同'}</View><View className="workspace-focus-title">{primary.title}</View><View className="workspace-focus-copy">{primary.description}</View><Button className="btn workspace-primary" onClick={()=>p.onAction(primary.action)}>{primary.label}<Text> →</Text></Button></View>
    {(c.inspector||c.reviewer)&&<View className="workspace-metrics">
      {c.inspector&&<><View className="workspace-metric"><View className="workspace-metric-value">{p.today??'—'}<Text>卷</Text></View><View className="workspace-metric-label">今日提交</View></View><View className="workspace-metric"><View className="workspace-metric-value">{p.tasksLoaded===false?'—':p.tasks.reduce((sum,t)=>sum+t.pendingCount,0)}<Text>卷</Text></View><View className="workspace-metric-label">已登记待处理</View></View></>}
      <View className="workspace-metric" onClick={()=>p.onAction(c.reviewer?'reviews':'drafts')}><View className="workspace-metric-value">{c.reviewer?(p.pendingReviews??'—'):p.drafts.length}<Text>{c.reviewer?'条':'份'}</Text></View><View className="workspace-metric-label">{c.reviewer?'待我审核':'本机草稿'}</View></View>
    </View>}
    <View className="workspace-section"><View className="workspace-section-title">工作入口</View><View className="workspace-actions">{actions.map(a=><View className="workspace-action" key={a.id} onClick={()=>p.onAction(a.id)}><View className="workspace-action-icon"><Image className="theme-icon" src={a.icon} mode="aspectFit"/></View><View className="workspace-action-copy"><View className="workspace-action-title">{a.title}</View><View className="workspace-action-note">{a.description}</View></View><Text className="workspace-arrow">›</Text></View>)}</View></View>
    {c.inspector&&p.tasksLoaded!==false&&p.tasks.length>0&&<View className="workspace-section"><View className="workspace-section-title">待办任务</View>{p.tasks.slice(0,2).map(t=><View key={t.id} className="workspace-task" onClick={()=>p.onTask(t.id)}><View className="workspace-task-title">{t.title}</View><View className="workspace-action-note">{t.taskNo} · 审核完成 {t.doneCount} 卷 / 已登记 {t.rollCount} 卷</View></View>)}</View>}
    {p.showDrafts&&c.inspector&&<View className="workspace-section list-section"><View className="workspace-section-title">本机草稿</View>{!p.drafts.length&&<View className="workspace-note">本机暂无检验草稿</View>}{p.drafts.map(d=><View key={d.id} className="workspace-task" onClick={()=>p.onDraft(d.id)}><View className="workspace-task-title">检验草稿</View><View className="workspace-action-note">{d.savedAt} · {d.dirty?'有修改待同步':'已保存'}</View></View>)}</View>}
    <View className="workspace-note"><View className="workspace-note-title">{c.business?'结果开放规则':'工作提示'}</View>{workflowNote}</View>
    <WorkspaceNav current="home" canScan={c.inspector} onNavigate={p.onNavigate}/>
  </View>;
}
