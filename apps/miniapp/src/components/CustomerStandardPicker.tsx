import {Picker,View} from '@tarojs/components';
import type {CustomerStandardOption} from '@/lib/orders';
export default function CustomerStandardPicker({options,value,onChange,disabled=false,placeholder="无特殊要求，使用永盛厂标"}:{options?:CustomerStandardOption[];value:string;onChange:(id:string)=>void;disabled?:boolean;placeholder?:string}) {
 const items=[{id:'',name:placeholder},...(options??[]).map(s=>({id:s.id,name:`${s.name} · ${s.customer?.name??'客户未记录'} · v${s.currentVersion?.version??'—'}`}))];
 const selected=items.findIndex(s=>s.id===value);
 return <View className="field"><View className="label">本单客户书面标准</View><Picker disabled={disabled||options===undefined} range={items.map(s=>s.name)} value={Math.max(0,selected)} onChange={e=>onChange(items[Number(e.detail.value)]?.id??'')}><View className="picker-value">{selected<0?'原客户标准（当前不可重新选择）':items[selected].name}</View></Picker><View className="muted">{options===undefined?'当前服务未提供客户标准选项，已有选择保持不变。':'仅可选择本单有权限使用的已发布客户标准；采用客户标准时按其规则检验。'}</View></View>;
}
