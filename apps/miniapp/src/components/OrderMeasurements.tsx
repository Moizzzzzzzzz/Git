import {Button,Input,View} from '@tarojs/components';
import Taro from '@tarojs/taro';
import {useState} from 'react';
import {usePageApi} from '@/lib/use-page-context';
import {errorText} from '@/lib/api';
import {measurementInput} from '@/lib/order-measurements';
import type {OrderRoll} from '@/lib/orders';
export default function OrderMeasurements({roll,version,after}:{roll:OrderRoll;version:number;after:()=>Promise<void>}){
 const api=usePageApi();const [open,setOpen]=useState(false);const [length,setLength]=useState('');const [weight,setWeight]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function save(kind:'save'|'length'|'weight'){if(busy)return;if(kind!=='save'&&!(await Taro.showModal({title:'清除手工补录',content:`确认清除${kind==='length'?'米数':'重量'}手工补录？原检验记录保留。`})).confirm)return;setBusy(true);setError('');try{await api.put(`/lots/${roll.lotId}/rolls/${roll.id}/measurements`,{version,...(kind==='save'?measurementInput(length,weight):kind==='length'?{measuredLengthM:null}:{measuredWeightKg:null})});setLength('');setWeight('');await after();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <View><Button className="btn small secondary" onClick={()=>setOpen(v=>!v)}>手工补录实测值</Button>{open&&<><View className="muted">留空保持原值，原检验记录不变。补录按系统记录时间留痕，清除后补打仍可采用原检验值。</View>{error&&<View className="error-box">{error}</View>}<Input className="input" type="digit" placeholder="实测米数（最多两位小数）" value={length} onInput={e=>setLength(e.detail.value)}/><Input className="input" type="digit" placeholder="实测重量 kg（最多三位小数）" value={weight} onInput={e=>setWeight(e.detail.value)}/><Button className="btn secondary" disabled={busy} onClick={()=>void save('save')}>保存补录</Button><View className="row-gap"><Button className="btn small secondary" disabled={busy} onClick={()=>void save('length')}>清除米数补录</Button><Button className="btn small secondary" disabled={busy} onClick={()=>void save('weight')}>清除重量补录</Button></View></>}</View>;
}
