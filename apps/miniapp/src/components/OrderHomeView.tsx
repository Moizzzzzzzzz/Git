import {Button,Input,Text,View} from '@tarojs/components';
import {useEffect,useState} from 'react';
import type {OrderSummary} from '@/lib/orders';
import {usePageApi,usePageContext} from '@/lib/use-page-context';
import {contextPhase,sameIdentity} from '@/lib/session-context';
import {createOrderHomeSearch,type OrderHomeSearchState} from '@/lib/order-home-search';
import WorkspaceNav from './WorkspaceNav';
import './BusinessHomeView.scss';
export const ORDER_STAGES=[{key:'UNASSIGNED',label:'待分发'},{key:'INSPECTING',label:'验布中'},{key:'PENDING_CONFIRMATION',label:'待主管确认'},{key:'COMPLETED',label:'已完成'}];
export default function OrderHomeView({items,loading,error,onOpen,onRetry}:{items:OrderSummary[]|null;loading:boolean;error:string;onOpen:(url:string)=>void;onRetry:()=>void}){
 const api=usePageApi(),ctx=usePageContext();
 const [search,setSearch]=useState<OrderHomeSearchState<OrderSummary>>({query:'',items:null,loading:false,error:''});
 const [control]=useState(()=>createOrderHomeSearch<OrderSummary>({get:path=>api.get<{items:OrderSummary[]}>(path),isCurrent:()=>sameIdentity(ctx)&&contextPhase()==='ready',publish:setSearch}));
 useEffect(()=>()=>control.dispose(),[control]);
 const searching=!!search.query.trim();const visible=searching?(search.items??[]):(items??[]);const follow=(items??[]).filter(o=>o.capabilities?.canRemind||o.status==='PENDING_CONFIRMATION');
 const shownLoading=searching?search.loading:loading,shownError=searching?search.error:error;
 const list=(status?:string)=>onOpen(`/pages/orders/list${status?`?status=${status}`:''}`);
 return <View className="container business-home">
  <View className="business-search"><View className="business-search-icon"/><Input className="business-search-input" placeholderClass="field-placeholder" placeholder="搜索 H 号、客户或面料" value={search.query} onInput={e=>control.input(e.detail.value)} confirmType="search" onConfirm={()=>control.submit()}/><Button className="business-search-clear" disabled={!search.query} onClick={()=>control.input('')}>清除</Button></View>
  <Button className="btn business-create" onClick={()=>onOpen('/pages/orders/edit')}>＋ 布置验布任务</Button>
  <View className="business-section-heading"><Text>订单概览</Text><Button className="business-more" onClick={()=>onOpen('/pages/orders/import')}>导入 VCANS ›</Button></View>
  <View className="business-overview">{ORDER_STAGES.map(s=><Button className="business-stat" key={s.key} disabled={!items} onClick={()=>list(s.key)}><Text className="business-stat-count">{items?items.filter(o=>o.status===s.key).length:'—'}</Text><Text className="business-stat-label">{s.label}</Text></Button>)}</View>
  {shownLoading&&<View className="empty">{searching?'正在搜索订单…':'正在加载订单…'}</View>}
  {shownError&&<View className="error-box">{shownError}<Button className="btn secondary" onClick={searching?()=>control.submit():onRetry}>重试</Button></View>}
  {!shownLoading&&!shownError&&<>
   {!searching&&<><View className="business-section-heading"><Text>需要跟进</Text><Button className="business-more" onClick={()=>list('PENDING_CONFIRMATION')}>查看全部 ›</Button></View>{follow.length?follow.slice(0,1).map(o=><View className="business-follow-row" key={o.id} onClick={()=>onOpen(`/pages/orders/detail?id=${o.id}`)}><View className="business-follow-copy"><View className="business-task-title">{o.hNo}</View><View className="business-task-meta">原定已验 {o.progress?.originalInspected??'—'} 卷 · 待主管审核</View></View><Text className="business-result">查看 ›</Text></View>):<View className="business-empty-card">暂无需要跟进的订单</View>}</>}
   <View className="business-section-heading"><Text>{searching?'搜索结果':'最近订单'}</Text><Button className="business-more" onClick={()=>list()}>全部订单 ›</Button></View>
   {visible.length?<View className="business-task-list">{(searching?visible:visible.slice(0,4)).map(o=><View className="business-task-row" key={o.id} onClick={()=>onOpen(`/pages/orders/detail?id=${o.id}`)}><View className="business-task-top"><Text className="business-task-title">{o.hNo}</Text><Text className="tag">{ORDER_STAGES.find(s=>s.key===o.status)?.label??'处理中'}</Text></View><View className="business-task-meta">{o.arrivalComplete?'货物已到齐':'到货登记中'} · 实物 {o.progress?.totalRolls??'—'} 卷</View><View className="business-task-progress"><Text>原定已验 {o.progress?.originalInspected??'—'} / 应检 {o.progress?.originalRequired??'—'} 卷</Text><Text className="business-result">{o.status==='COMPLETED'?'查看报告':'查看进度'} ›</Text></View></View>)}</View>:<View className="business-empty-card">{searching?'没有匹配的订单':'暂无订单'}</View>}
  </>}
  <Button className="btn secondary" onClick={()=>onOpen('/pages/business/list')}>历史业务任务</Button>
  <WorkspaceNav current="home" canScan={false} onNavigate={page=>{if(page==='home')return;onOpen(page==='tasks'?'/pages/orders/list':page==='messages'?'/pages/notifications/index':'/pages/me/index');}}/>
 </View>;
}
