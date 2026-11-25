import {Button,Picker,View} from '@tarojs/components';
import {useEffect,useState} from 'react';
import {usePageApi} from '@/lib/use-page-context';
import {errorText} from '@/lib/api';
import type {OrderDetail,OrderOptions} from '@/lib/orders';
export default function OrderConfiguration({detail:d,after}:{detail:OrderDetail;after:()=>Promise<void>}){
 const api=usePageApi();const [standard,setStandard]=useState(d.order.fourPointStandardId??'');const [template,setTemplate]=useState(d.order.templateId??'');const [options,setOptions]=useState<OrderOptions|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{void api.get<OrderOptions>(`/orders/${d.order.id}/options`).then(setOptions).catch(e=>setError(errorText(e)));},[d.order.id]);
 async function save(){if(busy)return;setBusy(true);setError('');try{await api.put(`/orders/${d.order.id}`,{version:d.order.version,fourPointStandardId:standard,templateId:template});await after();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <View className="card"><View className="card-title">现场检验标准</View>{error&&<View className="error-box">{error}</View>}{options&&<><View className="label">检验标准</View><Picker range={options.standards?.map(x=>x.name)??[]} value={Math.max(0,options.standards?.findIndex(x=>x.id===standard)??0)} onChange={e=>setStandard(options.standards?.[Number(e.detail.value)]?.id??'')}><View className="picker-value">{options.standards?.find(x=>x.id===standard)?.name??'请选择标准'}</View></Picker><View className="label">检验模板</View><Picker range={options.templates?.map(x=>x.name)??[]} value={Math.max(0,options.templates?.findIndex(x=>x.id===template)??0)} onChange={e=>setTemplate(options.templates?.[Number(e.detail.value)]?.id??'')}><View className="picker-value">{options.templates?.find(x=>x.id===template)?.name??'请选择模板'}</View></Picker>{options.standards?.find(x=>x.id===standard)?.isDevDefault&&<View className="warn-box">当前为开发测试标准，未经正式确认。</View>}<Button className="btn secondary" disabled={busy||!standard||!template} onClick={()=>void save()}>保存检验标准</Button></>}</View>;
}
