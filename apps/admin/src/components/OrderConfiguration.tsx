import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {Button} from './ui/button';
import {Card,CardContent} from './ui/card';
import {NativeSelect} from './ui/input';
import {Field} from './ui/label';
import {QueryState} from './common';
import {api} from '@/lib/api';
import {useAction} from '@/lib/hooks';
import type {OrderDetail,OrderOptions} from '@/lib/orders';
export function OrderConfiguration({detail:d,after}:{detail:OrderDetail;after:()=>void}){
 const [standard,setStandard]=useState(d.order.fourPointStandardId??'');const [template,setTemplate]=useState(d.order.templateId??'');
 const q=useQuery({queryKey:['order-options',d.order.id],queryFn:()=>api.get<OrderOptions>(`/orders/${d.order.id}/options`)});
 const save=useAction(()=>api.put(`/orders/${d.order.id}`,{version:d.order.version,fourPointStandardId:standard,templateId:template}),{success:'检验标准已保存',onSuccess:after});
 return <Card><CardContent className="space-y-3 p-5"><h2 className="font-semibold">现场检验标准</h2><QueryState q={q}><Field label="检验标准"><NativeSelect value={standard} onChange={e=>setStandard(e.target.value)}><option value="">请选择标准</option>{q.data?.standards?.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field><Field label="检验模板"><NativeSelect value={template} onChange={e=>setTemplate(e.target.value)}><option value="">请选择模板</option>{q.data?.templates?.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>{q.data?.standards?.find(x=>x.id===standard)?.isDevDefault&&<p className="text-amber-700">当前为开发测试标准，未经正式确认。</p>}<Button disabled={!standard||!template||save.isPending} loading={save.isPending} onClick={()=>save.mutate(undefined)}>保存检验标准</Button></QueryState></CardContent></Card>;
}
