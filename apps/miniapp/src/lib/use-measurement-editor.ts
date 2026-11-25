import {useState} from 'react';

/** Raw text survives draft-status rerenders; numeric readings still use the existing debounced draft writer. */
export function useMeasurementEditor(readings:readonly {seq:number;value:number}[],onChange:(seq:number,text:string)=>void){
 const [editing,setEditing]=useState<{seq:number;text:string}|null>(null);
 const stored=(seq:number)=>readings.find(r=>r.seq===seq)?.value?.toString()??'';
 return {
  value:(seq:number)=>editing?.seq===seq?editing.text:stored(seq),
  focus:(seq:number,text:string)=>setEditing({seq,text}),
  input:(seq:number,text:string)=>{setEditing({seq,text});onChange(seq,text);},
  blur:(seq:number,text:string)=>{onChange(seq,text);setEditing(null);},
 };
}
