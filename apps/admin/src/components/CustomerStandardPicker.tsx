import {NativeSelect} from '@/components/ui/input';
import {Field} from '@/components/ui/label';
import type {CustomerStandardOption} from '@/lib/orders';
export function CustomerStandardPicker({options,value,onChange,disabled=false,placeholder="无特殊要求，使用永盛厂标"}:{options?:CustomerStandardOption[];value:string;onChange:(id:string)=>void;disabled?:boolean;placeholder?:string}) {
 const missing=!!value&&!options?.some(s=>s.id===value);
 return <Field label="本单客户书面标准"><NativeSelect disabled={disabled||options===undefined} value={value} onChange={e=>onChange(e.target.value)}>
  <option value="">{placeholder}</option>
  {missing&&<option value={value} disabled>原客户标准（当前不可重新选择）</option>}
  {options?.map(s=><option key={s.id} value={s.id}>{s.name} · {s.customer?.name??'客户未记录'} · v{s.currentVersion?.version??'—'}</option>)}
 </NativeSelect><p className="text-xs text-muted-foreground">{options===undefined?'当前服务未提供客户标准选项，已有选择保持不变。':'仅可选择本单有权限使用的已发布客户标准；采用客户标准时按其规则检验。'}</p></Field>;
}
