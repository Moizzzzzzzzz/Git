import {usePageDidShow} from '@/lib/use-page-show';
import { withDemoBoundary } from '@/components/DemoContextBar';
import { usePageApi } from '@/lib/use-page-context';
import { Button, Text, View } from '@tarojs/components';
import Taro,{usePullDownRefresh,useRouter} from '@tarojs/taro';
import {useState} from 'react';
import {api,errorText} from '@/lib/api';
import {currentMe,ensureLogin} from '@/lib/auth';
import {homeCapabilities} from '@/lib/home-workspace';
import {BUSINESS_STAGES,filterBusinessTasks,readBusinessHomeItems,type BusinessFilter,type BusinessHomeTask} from '@/lib/business-home';
import {BusinessTaskRows,TaskSearch} from '@/components/BusinessHomeView';
import BottomNav from '@/components/BottomNav';
import {useTaskReminder} from '@/lib/use-task-reminder';
function BusinessList(){
 const api=usePageApi();
 const params=useRouter().params;
 const [query,setQuery]=useState(params.q??'');
 const [stage,setStage]=useState<BusinessFilter>([...BUSINESS_STAGES.map(s=>s.key),'cancelled'].includes(params.stage??'')?params.stage as BusinessFilter:'all');
 const [follow,setFollow]=useState(params.follow==='1');
 const [items,setItems]=useState<BusinessHomeTask[]|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const reminder=useTaskReminder();const caps=homeCapabilities(currentMe()?.roles.map(r=>r.role)??[]);
 async function load(){setLoading(true);setError('');setItems(null);try{if(await ensureLogin()==='NEED_BIND'){await Taro.redirectTo({url:'/pages/bind/index'});return;}if(!homeCapabilities(currentMe()?.roles.map(r=>r.role)??[]).business)throw new Error('当前身份无权查看部门任务');setItems(readBusinessHomeItems(await api.get<unknown>('/tasks/business')));}catch(e){setError(errorText(e));}finally{setLoading(false);Taro.stopPullDownRefresh();}}
 usePageDidShow(()=>void load());usePullDownRefresh(()=>void load());
 const visible=items?filterBusinessTasks(items,query,stage,follow):[];
 return <View className="container business-home"><TaskSearch query={query} onChange={setQuery}/><Button className="btn secondary" onClick={()=>Taro.navigateTo({url:'/pages/orders/list'})}>H 号订单与报告</Button><View className="business-list-title">{follow?'需要跟进':'部门任务'}</View>
 <View className="business-list-filter">{[{key:'all',label:'全部'},...BUSINESS_STAGES,{key:'cancelled',label:'已取消'}].map(s=><Button className={`tag ${stage===s.key?'':'gray'}`} key={s.key} onClick={()=>setStage(s.key as BusinessFilter)}>{s.label}</Button>)}{follow&&<Button className="business-more" onClick={()=>setFollow(false)}>取消跟进筛选</Button>}</View>
 {loading&&<View className="empty">正在加载任务…</View>}{error&&<View className="error-box">{error}<Button className="btn small secondary" onClick={()=>void load()}>重试</Button></View>}{reminder.notice&&<View className="warn-box">{reminder.notice}</View>}
 {items&&!loading&&!error&&<><View className="business-task-meta">共 {visible.length} 项任务</View>{visible.length?visible.map(t=><View key={t.id}><BusinessTaskRows items={[t]} onOpen={id=>void Taro.navigateTo({url:`/pages/business/index?id=${encodeURIComponent(id)}`})}/>{follow&&caps.sales&&t.canRemind&&<Button className="business-remind" disabled={!!reminder.busyId} loading={reminder.busyId===t.id} onClick={()=>void reminder.remind(t.id)}>催审核</Button>}</View>):<View className="business-empty-card">没有匹配的任务</View>}</>}
 <BottomNav current="tasks"/></View>;
}

export default withDemoBoundary(BusinessList);
