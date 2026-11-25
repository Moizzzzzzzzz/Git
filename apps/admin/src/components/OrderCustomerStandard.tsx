import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '@/lib/api';
import {useAction} from '@/lib/hooks';
import {customerConfigurationInput} from '@/lib/customer-standard';
import type {OrderDetail,OrderCustomerOptions} from '@/lib/orders';
import {Button} from './ui/button';
import {NativeSelect} from './ui/input';
import {Field} from './ui/label';
import {Card,CardContent} from './ui/card';
import {QueryState} from './common';
import {CustomerStandardPicker} from './CustomerStandardPicker';
export function OrderCustomerStandard({detail:d,after}:{detail:OrderDetail;after:()=>void}){
 const [customer,setCustomer]=useState(d.order.customerId??'');
 const [standard,setStandard]=useState(d.order.customerStandardId??'');
 const q=useQuery({queryKey:['order-customer-options',d.order.id],queryFn:()=>api.get<OrderCustomerOptions>(`/orders/${d.order.id}/customer-options`),enabled:d.capabilities.canConfigureCustomerStandard===true});
 const save=useAction((restore:boolean)=>api.post(`/orders/${d.order.id}/customer-standard`,customerConfigurationInput(d.capabilities.canConfigureCustomerStandard,d.order.version,q.data,customer,standard,restore)),{success:'订单检验依据已更新',onSuccess:after});
 if(d.capabilities.canConfigureCustomerStandard!==true)return null;
 return <Card><CardContent className="space-y-3 p-5"><h2 className="font-semibold">客户书面标准配置</h2><QueryState q={q}>
 <Field label="客户"><NativeSelect value={customer} disabled={save.isPending} onChange={e=>{setCustomer(e.target.value);setStandard('');}}><option value="">请选择客户</option>{customer&&!q.data?.customers.some(c=>c.id===customer)&&<option value={customer} disabled>原客户（当前不可重新选择）</option>}{q.data?.customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</NativeSelect></Field>
 <CustomerStandardPicker options={q.data?.customerStandards.filter(s=>s.customer?.id===customer&&!!s.currentVersion?.id)} value={standard} onChange={setStandard} disabled={save.isPending||!customer} placeholder="请选择客户已发布标准"/>
 <div className="flex gap-2"><Button disabled={save.isPending||!customer||!standard} loading={save.isPending} onClick={()=>save.mutate(false)}>保存客户标准</Button>{(d.order.customerId||d.order.customerStandardId)&&<Button variant="outline" disabled={save.isPending} onClick={()=>{if(window.confirm('确定解除本单客户标准，恢复使用永盛厂标？已有检验及报告不会因此改写。'))save.mutate(true);}}>恢复永盛厂标</Button>}</div>
 </QueryState></CardContent></Card>;
}
