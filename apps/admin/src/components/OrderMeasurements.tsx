import {useState} from 'react';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {Field} from './ui/label';
import {api} from '@/lib/api';
import {useAction} from '@/lib/hooks';
import {measurementInput} from '@/lib/order-measurements';
import type {OrderRoll} from '@/lib/orders';
export function OrderMeasurements({roll,version,after}:{roll:OrderRoll;version:number;after:()=>void}){
 const [open,setOpen]=useState(false);const [length,setLength]=useState('');const [weight,setWeight]=useState('');
 const path=`/lots/${roll.lotId}/rolls/${roll.id}/measurements`;
 const save=useAction((kind:'save'|'length'|'weight')=>api.put(path,{version,...(kind==='save'?measurementInput(length,weight):kind==='length'?{measuredLengthM:null}:{measuredWeightKg:null})}),{success:'补录已更新',onSuccess:()=>{setLength('');setWeight('');after();}});
 return <div className="space-y-2"><Button variant="ghost" onClick={()=>setOpen(v=>!v)}>手工补录实测值</Button>{open&&<><p className="text-sm text-muted-foreground">留空保持原值；补录按系统记录时间留痕，原检验记录不变；清除补录后，补打仍可能采用原检验值。</p><div className="grid gap-2 md:grid-cols-2"><Field label="实测米数（两位小数）"><Input value={length} onChange={e=>setLength(e.target.value)} inputMode="decimal"/></Field><Field label="实测重量 kg（三位小数）"><Input value={weight} onChange={e=>setWeight(e.target.value)} inputMode="decimal"/></Field></div><div className="flex flex-wrap gap-2"><Button variant="outline" loading={save.isPending} disabled={save.isPending} onClick={()=>save.mutate('save')}>保存补录</Button>{(['length','weight'] as const).map(k=><Button variant="ghost" disabled={save.isPending} key={k} onClick={()=>{if(window.confirm(`确认清除${k==='length'?'米数':'重量'}的手工补录？原检验记录保留。`))save.mutate(k);}}>清除{k==='length'?'米数':'重量'}补录</Button>)}</div></>}</div>;
}
