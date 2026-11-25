import {usePageDidShow} from '@/lib/use-page-show';
import { withDemoBoundary } from '@/components/DemoContextBar';
import { usePageApi } from '@/lib/use-page-context';
import { Button, Text, View } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { hasRole } from '@/lib/auth';
import BottomNav from '@/components/BottomNav';
interface MyTask { id: string; taskNo: string; title: string; rollCount: number; plannedRollCount?:number|null; doneCount: number; pendingCount?: number; dueAt: string | null; assignee?:{name:string}|null; delivery?:{id:string}|null }
function Tasks() {
 const api=usePageApi();
 const inspector=hasRole('INSPECTOR');const supervisor=hasRole('QC_SUPERVISOR','QUALITY_MANAGER','ADMIN');const business=hasRole('SALES','BUSINESS_MANAGER','BUSINESS_CLERK');
 const [mode,setMode]=useState<'mine'|'supervisor'>(inspector?'mine':'supervisor'); const [tasks,setTasks]=useState<MyTask[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [page,setPage]=useState(1);const [total,setTotal]=useState(0);
 async function load(nextMode=mode,nextPage=1){if(!inspector&&!supervisor){setLoading(false);Taro.stopPullDownRefresh();return;}setLoading(true);setTasks([]);try{if(nextMode==='supervisor'){const r=await api.get<{items:MyTask[];total:number}>(`/tasks?page=${nextPage}&pageSize=20`);setTasks(r.items);setTotal(r.total);}else{const r=await api.get<MyTask[]>('/tasks/mine');setTasks(r);setTotal(r.length);}setMode(nextMode);setPage(nextPage);setError('');}catch(e){setError(errorText(e));}finally{setLoading(false);Taro.stopPullDownRefresh();}}
 usePageDidShow(()=>void load());usePullDownRefresh(()=>void load());
 return <View className="container"><View className="page-intro"><View className="page-intro-kicker">TASKS · 任务工作区</View><View className="page-intro-title">验布任务</View><View className="page-intro-note">按职责查看任务与处理进度</View></View><View className="card" onClick={()=>Taro.navigateTo({url:'/pages/orders/list'})}><View className="card-title">H 号订单与报告 →</View></View>{business&&<View className="card" onClick={()=>Taro.navigateTo({url:'/pages/business/list'})}><View className="card-title">本部门业务任务 →</View><View className="muted">布置任务、查看进度及已确认的整单结果</View></View>}{supervisor&&inspector&&<View className="row-gap"><Button className={`btn small ${mode==='mine'?'':'secondary'}`} onClick={()=>void load('mine')}>我的验布</Button><Button className={`btn small ${mode==='supervisor'?'':'secondary'}`} onClick={()=>void load('supervisor')}>主管派工</Button></View>}{error&&<View className="error-box">{error}，下拉可刷新。</View>}{loading&&<View className="empty">正在加载任务…</View>}{!loading&&!error&&(inspector||supervisor)&&!tasks.length&&<View className="empty">暂无任务</View>}{tasks.map(t=><View className="card" key={t.id} onClick={()=>Taro.navigateTo({url:`/pages/task/index?id=${t.id}`})}><View className="row"><Text className="card-title">{t.title}</Text><Text className="tag">{t.delivery?'整单已确认':`${t.doneCount}/${t.plannedRollCount??t.rollCount} 卷`}</Text></View><View className="muted">{t.taskNo} · {t.assignee?.name??'待主管分发'}{t.dueAt?` · 截止 ${t.dueAt.slice(0,10)}`:''}</View></View>)}{mode==='supervisor'&&total>20&&<View className="row-gap"><Button className="btn small secondary" disabled={page<=1||loading} onClick={()=>void load(mode,page-1)}>上一页</Button><Text>{page} / {Math.ceil(total/20)}</Text><Button className="btn small secondary" disabled={page*20>=total||loading} onClick={()=>void load(mode,page+1)}>下一页</Button></View>}<BottomNav current="tasks"/></View>;
}

export default withDemoBoundary(Tasks);
