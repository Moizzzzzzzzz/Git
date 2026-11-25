import {useState} from 'react';
import {api} from '@/lib/api';
import {useAction} from '@/lib/hooks';
import {requiredStandardModeInput,STANDARD_MODE_NAMES,type OrderDetail,type RequiredStandardMode} from '@/lib/orders';
import {Card,CardContent} from './ui/card';
import {Button} from './ui/button';
import {RequiredStandardPicker} from './RequiredStandardPicker';
export function OrderRequiredStandard({detail:d,after}:{detail:OrderDetail;after:()=>void}){
 const [mode,setMode]=useState<RequiredStandardMode|''>(d.order.requiredStandardMode??'');
 const save=useAction(()=>api.post(`/orders/${d.order.id}/required-standard-mode`,requiredStandardModeInput(d,mode)),{success:'验布标准要求已更新',onSuccess:after});
 if(d.capabilities.canChangeRequiredStandardMode!==true||d.order.taskId)return null;
 return <Card><CardContent className="space-y-3 p-5"><h2 className="font-semibold">变更验布标准</h2><RequiredStandardPicker value={mode} onChange={setMode} disabled={save.isPending}/><Button disabled={!mode||mode===d.order.requiredStandardMode||save.isPending} loading={save.isPending} onClick={()=>{if(!mode)return;const text=mode==='FACTORY'?'改为永盛厂标，并清除本单客户及客户标准配置？':'改为客户书面标准？主管完成客户标准配置后才能开始验布。';if(window.confirm(text))save.mutate(undefined);}}>确认使用{mode?STANDARD_MODE_NAMES[mode]:'所选标准'}</Button></CardContent></Card>;
}
