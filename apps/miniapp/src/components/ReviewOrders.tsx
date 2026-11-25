import { Button, Input, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { reviewGet, reviewPdf, reviewSelected } from '@/lib/review-access';
import { createOrderHomeSearch, type OrderHomeSearchState } from '@/lib/order-home-search';
import { ORDER_STATUS_LABELS, PLAN_NAMES, displayQuantity, type OrderDetail, type OrderSummary } from '@/lib/orders';
import './BusinessHomeView.scss';
type Report={version:number;confirmedAt:string;pdfStatus:string};
export default function ReviewOrders({onExit}:{onExit:()=>void}) {
 const [items,setItems]=useState<OrderSummary[]>([]),[detail,setDetail]=useState<OrderDetail|null>(null),[reports,setReports]=useState<Report[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [search,setSearch]=useState<OrderHomeSearchState<OrderSummary>>({query:'',items:null,loading:false,error:''});
 const alive=useRef(true),request=useRef(0),selectedId=useRef('');
 const [control]=useState(()=>createOrderHomeSearch<OrderSummary>({get:p=>reviewGet<{items:OrderSummary[]}>(p),isCurrent:()=>alive.current&&reviewSelected(),publish:setSearch}));
 useEffect(()=>{void load();return()=>{alive.current=false;request.current++;control.dispose();};},[]);
 async function load(){const n=++request.current;setBusy(true);setError('');try{const data=await reviewGet<{items:OrderSummary[]}>('/orders');if(alive.current&&n===request.current)setItems(data.items);}catch{if(alive.current&&n===request.current)setError('订单暂不可用，请重试；会话过期时请退出后重新登录。');}finally{if(alive.current&&n===request.current)setBusy(false);}}
 async function open(id:string){const n=++request.current;selectedId.current=id;setBusy(true);setError('');setDetail(null);setReports([]);try{const d=await reviewGet<OrderDetail>(`/orders/${id}`);const rs=d.capabilities.canExport?await reviewGet<{items:Report[]}>(`/orders/${id}/reports`):{items:[]};if(alive.current&&n===request.current){setDetail(d);setReports(rs.items);}}catch{if(alive.current&&n===request.current)setError('订单或报告暂不可用，请重试；会话过期时请退出后重新登录。');}finally{if(alive.current&&n===request.current)setBusy(false);}}
 async function pdf(id:string,version:number){if(busy)return;setBusy(true);setError('');const n=request.current;try{const path=await reviewPdf(`/orders/${id}/reports/${version}/pdf`);if(alive.current&&n===request.current)await Taro.openDocument({filePath:path,fileType:'pdf',showMenu:true});}catch{if(alive.current&&n===request.current)setError('报告打开失败，请重试；会话过期时请退出后重新登录。');}finally{if(alive.current&&n===request.current)setBusy(false);}}
 function back(){request.current++;selectedId.current='';setDetail(null);setReports([]);setError('');setBusy(false);}
 const searching=!!search.query.trim(),visible=searching?(search.items??[]):items;
 return <View className="container business-home">
  <View className="row"><View className="page-intro-title">审核演示</View><Button className="btn small secondary" onClick={onExit}>退出审核</Button></View>
  <View className="muted">独立示例数据 · 仅查看订单与报告</View>
  {selectedId.current?<Button className="btn secondary" onClick={back}>返回订单</Button>:<>
   <View className="business-search"><View className="business-search-icon"/><Input className="business-search-input" placeholderClass="field-placeholder" placeholder="搜索 H 号、客户或面料" value={search.query} onInput={e=>control.input(e.detail.value)} confirmType="search" onConfirm={()=>control.submit()}/><Button className="business-search-clear" disabled={!search.query} onClick={()=>control.input('')}>清除</Button></View>
   <View className="business-section-heading"><Text>示例订单</Text></View>
   {search.loading&&<View className="empty">正在搜索订单…</View>}
   {search.error&&<View className="error-box">{search.error}<Button className="btn secondary" onClick={()=>control.submit()}>重试</Button></View>}
   {!search.loading&&!search.error&&visible.map(o=><View className="business-task-row" key={o.id} onClick={()=>void open(o.id)}><View className="business-task-top"><Text className="business-task-title">{o.hNo}</Text><Text className="tag">{ORDER_STATUS_LABELS[o.status??'']??'处理中'}</Text></View><View className="business-task-meta">{PLAN_NAMES[o.planMode]} · 原定已验 {o.progress?.originalInspected??'—'} / 应检 {o.progress?.originalRequired??'—'} 卷</View><Text className="business-result">查看订单 / 报告 ›</Text></View>)}
   {!busy&&!search.loading&&!search.error&&visible.length===0&&<View className="empty">{searching?'没有匹配的订单':'暂无示例订单'}</View>}
  </>}
  {busy&&<View className="empty">正在加载…</View>}
  {error&&<View className="error-box">{error}<Button className="btn secondary" onClick={()=>void(selectedId.current?open(selectedId.current):load())}>重试</Button></View>}
  {detail&&<><View className="card"><View className="card-title">{detail.order.hNo}</View><View>{PLAN_NAMES[detail.order.planMode]} · {detail.order.arrivalComplete?'订单已到齐':'到货登记中'}</View><View>原定已验 {detail.progress?.originalInspected??'—'} / 应检 {detail.progress?.originalRequired??'—'} 卷 · 已审核 {detail.progress?.originalReviewed??'—'} 卷</View></View>
   <View className="card"><View className="card-title">订单明细</View>{detail.lines.map((l,i)=><View key={l.id??i} style={{padding:'16px 0'}}><View>{l.productName||'未填写品名'} · {l.color||'—'}</View><View>客户订单号：{l.customerOrderNo||'—'}</View><View>物料号：{l.productCode||'—'}</View><View>规格：{l.specification||'—'}</View><View>订单量：{displayQuantity(l.quantity,l.quantityUnit??'')}</View></View>)}</View>
   <View className="card"><View className="card-title">整单报告</View>{!detail.capabilities.canExport?<View className="muted">主管整单确认后开放报告</View>:reports.length?reports.map(v=><View key={v.version}><View>版本 {v.version} · {v.confirmedAt.slice(0,10)}</View><Button className="btn secondary" disabled={busy} onClick={()=>void pdf(detail.order.id,v.version)}>查看 PDF 报告</Button></View>):<View className="muted">暂无报告</View>}</View>
  </>}
 </View>;
}
