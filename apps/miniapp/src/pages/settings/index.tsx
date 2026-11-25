import {usePageDidShow} from '@/lib/use-page-show';
import {demoCapability,demoConfigured,returnToReal} from '@/lib/demo-session';
import {currentContext} from '@/lib/session-context';
import {ApiError,toastError} from '@/lib/api';
import { withDemoBoundary } from '@/components/DemoContextBar';
import { usePageApi } from '@/lib/use-page-context';
import Taro, { } from '@tarojs/taro';
import { useState } from 'react';
import SettingsView from '@/components/SettingsView';
import type {ReminderConfiguration} from '@/lib/reminder-allowances';
import { api } from '@/lib/api';
import { currentMe, logout } from '@/lib/auth';
import { isDirty, listLocalDrafts } from '@/lib/draft';
import { logoutConfirmation } from '@/lib/profile-workspace';
function Settings(){
 const api=usePageApi();
 const me=currentMe();
 const demo=currentContext().kind==='demo';
 const [demoAccess,setDemoAccess]=useState(false);
 const [demoError,setDemoError]=useState(false);
 const [subs,setSubs]=useState<ReminderConfiguration|null>(null);
 const [error,setError]=useState(false);
 const drafts=listLocalDrafts();
 const unsynced=drafts.filter(d=>isDirty(d)||d.photos.some(p=>p.status!=='uploaded')).length;
 function load(){if(demoConfigured()){setDemoError(false);demoCapability().then(c=>setDemoAccess(c.enabled)).catch(e=>{setDemoAccess(false);setDemoError(!(e instanceof ApiError&&e.status===403));});}setError(false);setSubs(null);api.get<ReminderConfiguration>('/notifications/wechat-subscriptions').then(r=>setSubs(r)).catch(()=>{setSubs(null);setError(true);});}
 usePageDidShow(load);
 async function doLogout(){if(demo){try{await returnToReal();void Taro.reLaunch({url:'/pages/index/index'});}catch(e){toastError(e);}return;}const r=await Taro.showModal({title:'退出登录？',content:logoutConfirmation(unsynced)});if(!r.confirm)return;await logout();void Taro.reLaunch({url:'/pages/index/index'});}
 return <SettingsView demo={demo} demoAccess={demoAccess} demoError={demoError} person={{name:me?.name??'',employeeNo:me?.employeeNo??'',department:me?.department?.name??'',roles:me?.roles.map(r=>r.role)??[]}} configuration={subs} subscriptionError={error} draftCount={drafts.length} unsynced={unsynced} onRetry={load} onOpen={url=>void Taro.navigateTo({url})} onLogout={()=>void doLogout()}/>;
}

export default withDemoBoundary(Settings);
