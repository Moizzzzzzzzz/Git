import {NativeSelect} from './ui/input';
import {Field} from './ui/label';
import {STANDARD_MODE_NAMES,type RequiredStandardMode} from '@/lib/orders';
export function RequiredStandardPicker({value,onChange,disabled=false}:{value:RequiredStandardMode|'';onChange:(value:RequiredStandardMode|'')=>void;disabled?:boolean}){return <Field label="验布标准" required><NativeSelect value={value} disabled={disabled} onChange={e=>onChange(e.target.value as RequiredStandardMode|'')}><option value="">请选择验布标准</option>{Object.entries(STANDARD_MODE_NAMES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</NativeSelect></Field>;}
