import {useEffect,useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,Picker,View} from '@tarojs/components';
import {usePageApi} from '@/lib/use-page-context';
import {errorText} from '@/lib/api';
import {customerConfigurationInput} from '@/lib/customer-standard';
import type {OrderDetail,OrderCustomerOptions} from '@/lib/orders';
import CustomerStandardPicker from './CustomerStandardPicker';
export default function OrderCustomerStandard({detail:d,after}:{detail:OrderDetail;after:()=>Promise<void>}){
 const api=usePageApi();const [customer,setCustomer]=useState(d.order.customerId??'');const [standard,setStandard]=useState(d.order.customerStandardId??'');const [options,setOptions]=useState<OrderCustomerOptions|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{if(d.capabilities.canConfigureCustomerStandard!==true)return;let active=true;void api.get<OrderCustomerOptions>(`/orders/${d.order.id}/customer-options`).then(v=>{if(active)setOptions(v);}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[d.order.id]);
 async function save(restore=false){if(busy)return;if(restore&&!(await Taro.showModal({title:'恢复永盛厂标？',content:'解除本单客户标准；已有检验及报告不会因此改写。'})).confirm)return;setBusy(true);setError('');try{const body=customerConfigurationInput(d.capabilities.canConfigureCustomerStandard,d.order.version,options,customer,standard,restore);await api.post(`/orders/${d.order.id}/customer-standard`,body);await after();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 if(d.capabilities.canConfigureCustomerStandard!==true)return null;
 return <View className="card"><View className="card-title">客户书面标准配置</View>{error&&<View className="error-box">{error}</View>}{!options&&!error&&<View className="muted">正在加载可用客户标准…</View>}{options&&<><View className="label">客户</View><Picker disabled={busy} range={options.customers.map(c=>`${c.name} · ${c.code}`)} value={Math.max(0,options.customers.findIndex(c=>c.id===customer))} onChange={e=>{setCustomer(options.customers[Number(e.detail.value)]?.id??'');setStandard('');}}><View className="picker-value">{options.customers.find(c=>c.id===customer)?.name??(customer?'原客户（当前不可重新选择）':'请选择客户')}</View></Picker><CustomerStandardPicker options={options.customerStandards.filter(s=>s.customer?.id===customer&&!!s.currentVersion?.id)} value={standard} onChange={setStandard} disabled={busy||!customer} placeholder="请选择客户已发布标准"/><Button className="btn secondary" disabled={busy||!customer||!standard} onClick={()=>void save()}>保存客户标准</Button>{(d.order.customerId||d.order.customerStandardId)&&<Button className="btn secondary" disabled={busy} onClick={()=>void save(true)}>恢复永盛厂标</Button>}</>}</View>;
}
