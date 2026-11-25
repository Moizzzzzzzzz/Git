import {useState} from 'react';
import Taro from '@tarojs/taro';
import {Button,View} from '@tarojs/components';
import {usePageApi} from '@/lib/use-page-context';
import {errorText} from '@/lib/api';
import {requiredStandardModeInput,STANDARD_MODE_NAMES,type OrderDetail,type RequiredStandardMode} from '@/lib/orders';
import RequiredStandardPicker from './RequiredStandardPicker';
export default function OrderRequiredStandard({detail:d,after}:{detail:OrderDetail;after:()=>Promise<void>}){
 const api=usePageApi();const [mode,setMode]=useState<RequiredStandardMode|''>(d.order.requiredStandardMode??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function save(){if(busy||!mode)return;const ok=await Taro.showModal({title:'变更验布标准？',content:mode==='FACTORY'?'改为永盛厂标，并清除本单客户及客户标准配置。':'改为客户书面标准；主管完成客户标准配置后才能开始验布。'});if(!ok.confirm)return;setBusy(true);setError('');try{await api.post(`/orders/${d.order.id}/required-standard-mode`,requiredStandardModeInput(d,mode));await after();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 if(d.capabilities.canChangeRequiredStandardMode!==true||d.order.taskId)return null;
 return <View className="card"><View className="card-title">变更验布标准</View>{error&&<View className="error-box">{error}</View>}<RequiredStandardPicker value={mode} onChange={setMode} disabled={busy}/><Button className="btn secondary" disabled={!mode||mode===d.order.requiredStandardMode||busy} onClick={()=>void save()}>确认使用{mode?STANDARD_MODE_NAMES[mode]:'所选标准'}</Button></View>;
}
