import {Picker,View} from '@tarojs/components';
import {filterSchemes,schemeScopeText,type SchemeApplicability,type SchemeFilter} from '@/lib/scheme-options';
export interface SchemeOption{id:string;name:string;isDevDefault?:boolean;applicability?:SchemeApplicability|null}
export default function SchemePicker({label,items,value,filter,onChange}:{label:string;items:SchemeOption[];value:string;filter:SchemeFilter;onChange:(id:string)=>void}){
 const groups=filterSchemes(items,filter);const values=[...groups.matched,...groups.unclassified];const selected=values.find(x=>x.id===value);
 const optionText=(x:SchemeOption)=>`${x.applicability?'':'【未标注】'}${x.isDevDefault?'【测试】':''}${x.name}`;
 return <View className="field"><View className="label">{label}</View><Picker mode="selector" range={values.map(optionText)} value={Math.max(0,values.findIndex(x=>x.id===value))} onChange={e=>onChange(values[Number(e.detail.value)]?.id??'')}><View className={`picker-value${selected?'':' is-placeholder'}`}>{selected?optionText(selected):`请选择${label}`}</View></Picker>
 {selected&&<View className="muted">{schemeScopeText(selected.applicability)}</View>}
 {(filter.structure||filter.fiber)&&<View className="muted">匹配方案 {groups.matched.length} 项；未标注方案 {groups.unclassified.length} 项（不计匹配）。</View>}
 {!values.length&&<View className="muted">暂无可选方案，请调整筛选或联系管理员。</View>}
 </View>;
}
