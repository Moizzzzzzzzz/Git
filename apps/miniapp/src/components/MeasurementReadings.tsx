import {Button,Input,View} from '@tarojs/components';
import {useState} from 'react';
import {measurementRowCount} from '@/lib/measurement-input';
import {useMeasurementEditor} from '@/lib/use-measurement-editor';
export default function MeasurementReadings({minReadings,readings,editable,onChange}:{minReadings:number;readings:readonly {seq:number;value:number}[];editable:boolean;onChange:(seq:number,text:string)=>void}){
 const [visibleCount,setVisibleCount]=useState(0);
 const editor=useMeasurementEditor(readings,onChange);
 const count=measurementRowCount(minReadings,readings,visibleCount);
 return <><View className="readings">{Array.from({length:count},(_,i)=>i+1).map(seq=><Input key={seq} placeholderClass="field-placeholder" className="input reading" type="digit" disabled={!editable} placeholder={`读数 ${seq}`} value={editor.value(seq)} onFocus={e=>editor.focus(seq,e.detail.value)} onInput={e=>editor.input(seq,e.detail.value)} onBlur={e=>editor.blur(seq,e.detail.value)}/>)}</View>{editable&&<Button className="btn small ghost" style={{marginTop:'12px'}} disabled={count>=50} onClick={()=>setVisibleCount(count+1)}>{count>=50?'最多 50 个读数':'＋ 增加读数'}</Button>}</>;
}
