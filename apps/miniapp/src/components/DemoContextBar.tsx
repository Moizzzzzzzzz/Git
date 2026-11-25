import {finishDemoTransition} from '@/lib/demo-navigation';
import {Button,Text,View} from '@tarojs/components';
import Taro from '@tarojs/taro';
import {useEffect,useState,type ComponentType} from 'react';
import {ROLE_LABELS} from '@fabricqc/shared';
import {activeDemo,contextChanged,contextPhase,currentContext,sameIdentity} from '@/lib/session-context';
import {recoverDemo,returnToReal} from '@/lib/demo-session';
import {currentMe,ensureLogin} from '@/lib/auth';
import {errorText} from '@/lib/api';
import './DemoContextBar.scss';
export function useContextRender(){const [,render]=useState(0);useEffect(()=>contextChanged(()=>render(n=>n+1)),[]);}
export default function DemoContextBar(){
 useContextRender();const phase=contextPhase(),demo=activeDemo();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function action(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await finishDemoTransition(fn);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 if(!demo&&phase==='ready')return null;
 return <><View className="demo-context-bar"><Text>{demo?`演示 · ${ROLE_LABELS[demo.role]}`:'演示身份切换'}</Text><Button className="demo-inline" onClick={()=>void Taro.navigateTo({url:'/pages/demo/index'})}>切换身份</Button><Button className="demo-inline" disabled={busy||phase==='switching'} onClick={()=>void action(returnToReal)}>切回本人</Button></View>
 {error&&<View className="error-box">{error}</View>}
 {phase!=='ready'&&<View className="demo-shield" catchMove><View className="demo-shield-card"><View className="card-title">{phase==='recovering'?'确认身份切换结果':'正在切换身份'}</View><View className="muted">{phase==='recovering'?'恢复完成前暂停操作，原草稿保持不变。':'正在等待保存或上传结束，请稍候。'}</View>{phase==='recovering'&&<><Button className="btn" loading={busy} disabled={busy} onClick={()=>void action(recoverDemo)}>恢复切换</Button><Button className="btn ghost" disabled={busy} onClick={()=>void action(returnToReal)}>切回本人</Button></>}{error&&<View className="error-box">{error}</View>}</View></View>}
 </>;
}
/** One boundary per actual Taro page; no DOM-only app wrapper. */
export function withDemoBoundary(Page:ComponentType){return function ContextPage(){
 useContextRender();const [origin]=useState(currentContext);const [checked,setChecked]=useState(origin.kind==='real'||!!currentMe());const [error,setError]=useState('');
 async function check(){try{await ensureLogin();if(sameIdentity(origin)){setChecked(true);setError('');}}catch(e){setError(errorText(e));}}
 useEffect(()=>{if(origin.kind==='demo'&&!checked&&contextPhase()==='ready')void check();},[]);
 return <><DemoContextBar/>{sameIdentity(origin)&&(checked?<Page/>:<View className="container"><View className="muted">{error||'正在核对演示身份…'}</View>{error&&<Button className="btn secondary" onClick={()=>void check()}>重新核对</Button>}</View>)}</>;
};}
