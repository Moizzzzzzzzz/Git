import {Picker,View} from '@tarojs/components';
import {STANDARD_MODE_NAMES,type RequiredStandardMode} from '@/lib/orders';
const modes:(''|RequiredStandardMode)[]=['','FACTORY','CUSTOMER_REQUIRED'];
export default function RequiredStandardPicker({value,onChange,disabled=false}:{value:RequiredStandardMode|'';onChange:(value:RequiredStandardMode|'')=>void;disabled?:boolean}){return <View className="field"><View className="label">验布标准</View><Picker disabled={disabled} range={['请选择验布标准',STANDARD_MODE_NAMES.FACTORY,STANDARD_MODE_NAMES.CUSTOMER_REQUIRED]} value={Math.max(0,modes.indexOf(value))} onChange={e=>onChange(modes[Number(e.detail.value)]??'')}><View className={`picker-value${value?'':' is-placeholder'}`}>{value?STANDARD_MODE_NAMES[value]:'请选择验布标准'}</View></Picker></View>;}
