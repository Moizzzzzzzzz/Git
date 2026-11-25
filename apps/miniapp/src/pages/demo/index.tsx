import {usePageDidShow} from '@/lib/use-page-show';
import {finishDemoTransition} from '@/lib/demo-navigation';
import {Button,Text,View} from '@tarojs/components';
import Taro,{useDidShow} from '@tarojs/taro';
import {useState} from 'react';
import {ROLE_LABELS} from '@fabricqc/shared';
import {demoCapability,switchDemoPersona,recoverDemo,returnToReal,type DemoCapability} from '@/lib/demo-session';
import {activeDemo,contextPhase} from '@/lib/session-context';
import {ApiError,errorText} from '@/lib/api';
import {useContextRender} from '@/components/DemoContextBar';
import './index.scss';
const ACTIONS:Record<string,string>={SALES:'布置任务、跟进进度',BUSINESS_MANAGER:'查看本部门进度和结果',BUSINESS_CLERK:'查看本部门进度和结果',INSPECTOR:'登记布卷、验布与提交',QC_SUPERVISOR:'分发任务、审核与整单确认',QUALITY_MANAGER:'查看质检任务与审核',ADMIN:'查看隔离环境任务'};
export default function Demo(){
 useContextRender();const [cap,setCap]=useState<DemoCapability|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const d=activeDemo();
 async function load(){try{setCap(await demoCapability());setError('');}catch(e){setCap(null);setError(e instanceof ApiError&&e.status===403?'当前账号没有演示权限':errorText(e));}}
 usePageDidShow(()=>void load());
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await finishDemoTransition(fn);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <View className="container demo-page"><View className="settings-title">演示身份</View><View className="demo-current">{d?`当前：演示 · ${ROLE_LABELS[d.role]}`:'当前：本人账号'}</View><View className="muted">使用隔离演示数据，不发送真实微信提醒。</View>{error&&<View className="error-box">{error}</View>}
 {contextPhase()==='recovering'?<View className="card"><View className="card-title">身份切换待恢复</View><View className="muted">尚未确认切换结果，暂不继续业务操作。</View><Button className="btn" disabled={busy} onClick={()=>void run(recoverDemo)}>恢复切换</Button></View>:<View className="demo-personas">{cap?.enabled&&cap.personas.map(p=><Button key={p.personaId} className={`demo-persona${d?.personaId===p.personaId?' selected':''}`} disabled={busy||contextPhase()!=='ready'} onClick={()=>void run(()=>switchDemoPersona(p.personaId))}><View className="demo-persona-title">{ROLE_LABELS[p.role]}{d?.personaId===p.personaId&&<Text className="tag">当前</Text>}</View><View className="muted">{ACTIONS[p.role]??p.label}</View><View className="muted">{p.scopeLabel}</View></Button>)}</View>}
 {!cap&&contextPhase()==='ready'&&<Button className="btn secondary" disabled={busy} onClick={()=>void load()}>重新获取身份</Button>}
 {(d||contextPhase()==='recovering')&&<Button className="btn ghost" disabled={busy} onClick={()=>void run(returnToReal)}>切回本人，保留原草稿</Button>}
 {busy&&<View className="demo-wait">正在核对身份并等待当前操作结束…</View>}</View>;
}
