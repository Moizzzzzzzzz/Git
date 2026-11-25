import OrderHomeView from '@/components/OrderHomeView';
import type {OrderSummary} from '@/lib/orders';
import {usePageDidShow} from '@/lib/use-page-show';
import { withDemoBoundary } from '@/components/DemoContextBar';
import { usePageApi } from '@/lib/use-page-context';
import { Button, View } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { currentMe, ensureLogin, hasRole } from '@/lib/auth';
import { listLocalDrafts, isDirty, type LocalDraft } from '@/lib/draft';
import { scanRoll } from '@/lib/scan';
import HomeView, { type HomeAction, type HomeTask } from '@/components/HomeView';
import { homeCapabilities } from '@/lib/home-workspace';

import BusinessHomeView from '@/components/BusinessHomeView';
import { readBusinessHomeItems, type BusinessHomeTask } from '@/lib/business-home';
import { useTaskReminder } from '@/lib/use-task-reminder';

type MyTask = HomeTask;

function Index() {
 const api=usePageApi();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [tasksLoaded,setTasksLoaded]=useState(false);
  const [pendingReviews, setPendingReviews] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const [section, setSection] = useState<'drafts' | null>(null);
  const [orders,setOrders]=useState<OrderSummary[]|null>(null);
  const [businessItems,setBusinessItems]=useState<BusinessHomeTask[]|null>(null);
  const [businessLoading,setBusinessLoading]=useState(false);
  const [query,setQuery]=useState('');
  const reminder=useTaskReminder();
  const [today, setToday] = useState<number | null>(null);

  async function load() {
    try {
      const s = await ensureLogin();
      if (s === 'NEED_BIND') { await Taro.redirectTo({ url: '/pages/bind/index' }); return; }
      setState('ready'); setError(''); setTasksLoaded(false); setPendingReviews(null); setToday(null);
      setDrafts(hasRole('INSPECTOR') ? listLocalDrafts() : []);
      if (homeCapabilities(currentMe()?.roles.map(r=>r.role)??[]).business) {
        setBusinessLoading(true);setBusinessItems(null);
        try { if(homeCapabilities(currentMe()?.roles.map(r=>r.role)??[]).businessOnly)setOrders((await api.get<{items:OrderSummary[]}>('/orders')).items);else setBusinessItems(readBusinessHomeItems(await api.get<unknown>('/tasks/business'))); }
        finally { setBusinessLoading(false); }
        return;
      }
      const jobs: Promise<unknown>[] = [];
      if (hasRole('INSPECTOR')) {
        jobs.push(api.get<MyTask[]>('/tasks/mine').then(items=>{setTasks(items);setTasksLoaded(true);}));
        jobs.push(api.get<{ rolls: number }>('/inspections/mine/today').then(r => setToday(r.rolls)).catch(() => setToday(null)));
      }
      if (hasRole('QC_SUPERVISOR', 'QUALITY_MANAGER')) jobs.push(api.get<unknown[]>('/reviews/pending').then(r => setPendingReviews(r.length)));
      await Promise.all(jobs);
    } catch (e) { setError(errorText(e)); setState(currentMe() ? 'ready' : 'error'); }
    finally { Taro.stopPullDownRefresh(); }
  }
  usePageDidShow(() => { void load(); });
  usePullDownRefresh(() => void load());
  const me = currentMe();
  const capabilities=homeCapabilities(me?.roles.map(r=>r.role)??[]);
  const unsynced = drafts.filter(d => isDirty(d) || d.photos.some(p => p.status !== 'uploaded')).length;
  const navigate=(url:string)=>void Taro.navigateTo({url});
  const action=(value:HomeAction)=>{
    if(value==='scan') { if(capabilities.inspector) void scanRoll(); return; }
    if(value==='drafts') { setSection('drafts'); setTimeout(()=>void Taro.pageScrollTo({selector:'.list-section',duration:250}),100); return; }
    const routes={create:'/pages/business/index?create=1',business:'/pages/business/list',tasks:'/pages/tasks/index',reviews:'/pages/review/list',external:'/pages/external/index',me:'/pages/me/index'};
    navigate(routes[value]);
  };
  if (state === 'loading') return <View className="empty">正在登录…</View>;
  if (state === 'error') return <View className="container"><View className="error-box">{error}</View><Button className="btn" onClick={() => { setState('loading'); void load(); }}>重试</Button></View>;
  if(capabilities.businessOnly)return <OrderHomeView items={orders} loading={businessLoading} error={error} onOpen={navigate} onRetry={()=>void load()}/>;
  if(capabilities.business)return <BusinessHomeView roles={me?.roles.map(r=>r.role)??[]} items={businessItems} loading={businessLoading} error={error} query={query} onQuery={setQuery}
    busyId={reminder.busyId} notice={reminder.notice} onRemind={id=>{if(capabilities.sales&&businessItems?.find(t=>t.id===id)?.canRemind)void reminder.remind(id);}}
    onOpen={navigate} onRetry={()=>void load()} onQcAction={action} showDrafts={section==='drafts'}
    drafts={drafts.map(d=>({id:d.inspectionId,savedAt:new Date(d.savedAt).toLocaleString(),dirty:isDirty(d)}))} onDraft={id=>navigate(`/pages/inspect/index?id=${id}`)}
    onNavigate={page=>{if(page==='home')return;if(page==='scan'){action('scan');return;}navigate(page==='tasks'?'/pages/business/list':page==='messages'?'/pages/notifications/index':'/pages/me/index');}}/>;
  return <HomeView name={me?.name??''} department={me?.department?.name??''} roles={me?.roles.map(r=>r.role)??[]}
    today={today} pendingReviews={pendingReviews} tasks={tasks} tasksLoaded={tasksLoaded} error={error} unsynced={unsynced} showDrafts={section==='drafts'}
    drafts={drafts.map(d=>({id:d.inspectionId,savedAt:new Date(d.savedAt).toLocaleString(),dirty:isDirty(d)}))}
    onAction={action} onTask={id=>navigate(`/pages/task/index?id=${id}`)} onDraft={id=>navigate(`/pages/inspect/index?id=${id}`)}
    onNavigate={page=>{if(page==='home')return;if(page==='scan'){action('scan');return;}navigate(page==='tasks'?(capabilities.businessOnly?'/pages/business/list':'/pages/tasks/index'):page==='messages'?'/pages/notifications/index':'/pages/me/index');}}/>;
}

export default withDemoBoundary(Index);
