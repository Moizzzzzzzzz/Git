import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {PageHeader,QueryState} from '@/components/common';
import {api} from '@/lib/api';
import {useAuth} from '@/lib/auth';
import {canCreateOrder,ORDER_STATUS_LABELS,PLAN_NAMES,type OrderSummary} from '@/lib/orders';
export function OrdersPage(){
 const {me}=useAuth();const [search,setSearch]=useState('');
 const q=useQuery({queryKey:['orders',me?.id,search],queryFn:()=>api.get<{items:OrderSummary[]}>(`/orders${search?`?q=${encodeURIComponent(search)}`:''}`)});
 const create=canCreateOrder(me?.roles.map(r=>r.role)??[]);
 return <><PageHeader title="H 号订单" description="订单、抽检进度和整单报告" actions={<div className="flex flex-wrap gap-2">{create&&<><Button variant="outline" asChild><Link to="/orders/import">导入 VCANS</Link></Button><Button asChild><Link to="/orders/new">新建订单</Link></Button></>}<Button asChild variant="outline"><Link to="/business-tasks">历史任务</Link></Button></div>}/><Input aria-label="搜索订单" placeholder="搜索 H 号或客户订单号" value={search} onChange={e=>setSearch(e.target.value)} className="mb-4"/><QueryState q={q}><div className="space-y-3">{q.data?.items.map(o=><Card key={o.id}><CardContent className="space-y-2 p-5"><div className="flex justify-between gap-3"><Link className="font-semibold text-primary" to={`/orders/${o.id}`}>{o.hNo}</Link><span className="text-sm">{ORDER_STATUS_LABELS[o.status??'']??'处理中'}</span></div><p>{PLAN_NAMES[o.planMode]} · 实物 {o.progress?.totalRolls??'—'} 卷 · 原定应检 {o.progress?.originalRequired??'—'} 卷</p><p className="text-sm text-muted-foreground">原定已验 {o.progress?.originalInspected??'—'} 卷 · 待验 {o.progress?.originalPending??'—'} 卷 · 已审核 {o.progress?.originalReviewed??'—'} 卷 · 追加检验 {o.progress?.additionalCount??'—'} 卷{o.dueAt?` · 截止 ${o.dueAt.slice(0,10)}`:''}</p></CardContent></Card>)}{q.data?.items.length===0&&<Card><CardContent className="p-8 text-center">暂无订单</CardContent></Card>}</div></QueryState></>;
}
