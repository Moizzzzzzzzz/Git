import { Button, Input, View } from '@tarojs/components';
import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import ReviewOrders from '@/components/ReviewOrders';
import {enterReview,exitReview,loginReview,resumeReview,hasReviewRecovery,hasReviewSession,onReviewExpired} from '@/lib/review-access';

/** Credentials live only in this mounted form; they are never persisted or sent to employee/demo endpoints. */
export function ReviewAccessForm({ onSubmit,onBack }: { onSubmit?: (account: string, password: string) => Promise<void>;onBack:()=>void }) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => { active.current = false; }, []);
  useDidHide(() => { active.current = false; setPassword(''); });
  useDidShow(() => { active.current = true; setBusy(inFlight.current); });

  async function submit() {
    if (inFlight.current || !onSubmit) return;
    if (!account.trim() || !password) { setError('请输入审核账号和密码'); return; }
    inFlight.current = true;
    setBusy(true); setError('');
    const enteredPassword = password;
    setPassword('');
    try { await onSubmit(account.trim(), enteredPassword); }
    catch { if (active.current) setError('审核登录未完成，请核对账号或稍后重试'); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  return <View className="container">
    <View className="page-intro"><View className="page-intro-title">审核演示</View><View className="page-intro-note">使用独立示例数据，不影响员工实际业务。</View></View>
    <View className="card">
      <View className="field"><View className="label">审核账号</View><Input className="input" placeholderClass="field-placeholder" value={account} disabled={busy} onInput={e=>setAccount(e.detail.value)} placeholder="请输入审核账号" /></View>
      <View className="field"><View className="label">密码</View><Input className="input" placeholderClass="field-placeholder" password value={password} disabled={busy} onInput={e=>setPassword(e.detail.value)} placeholder="请输入密码" /></View>
      {error && <View className="error-box">{error}</View>}
      {!onSubmit && <View className="muted">审核入口暂不可用，请稍后重试。</View>}
      <Button className="btn" loading={busy} disabled={busy || !onSubmit} onClick={()=>void submit()}>进入审核演示</Button>
      <Button className="btn ghost" disabled={busy} onClick={()=>{setPassword('');onBack();}}>返回员工登录</Button>
    </View>
  </View>;
}

export default function ReviewAccess(){
 const [ready,setReady]=useState(false),[recover,setRecover]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[formKey,setFormKey]=useState(0);
 const alive=useRef(true);
 useEffect(()=>onReviewExpired(()=>{setReady(false);setRecover(false);setError('审核会话已失效，请重新登录');setFormKey(v=>v+1);}),[]);
 useEffect(()=>{void (async()=>{try{await enterReview();if(!alive.current)return;if(hasReviewRecovery()){setRecover(true);return;}if(hasReviewSession()){await resumeReview();if(alive.current)setReady(true);}}catch{if(alive.current)setError('审核登录需要重新确认，可恢复登录或退出后重试。');}})();return()=>{alive.current=false;};},[]);
 async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();if(alive.current){setReady(true);setRecover(false);}}catch{if(alive.current){setError('审核登录未完成，请核对账号；如结果待确认，请恢复登录。');setRecover(hasReviewRecovery());}throw new Error('审核登录未完成');}finally{if(alive.current)setBusy(false);}}
 async function exit(employee=false){await exitReview(employee);if(!alive.current)return;setReady(false);setRecover(false);setError('');setFormKey(v=>v+1);if(employee)await Taro.reLaunch({url:'/pages/index/index'});}
 if(ready)return <ReviewOrders onExit={()=>void exit()}/>;
 return <>{error&&<View className="container"><View className="error-box">{error}</View></View>}{recover?<View className="container"><View className="page-intro-title">审核登录待恢复</View><View className="muted">先核对上次结果，不重复提交账号密码。</View><Button className="btn" disabled={busy} loading={busy} onClick={()=>void run(resumeReview).catch(()=>undefined)}>恢复审核登录</Button><Button className="btn secondary" disabled={busy} onClick={()=>void exit()}>退出审核后重新登录</Button><Button className="btn ghost" disabled={busy} onClick={()=>void exit(true)}>返回员工登录</Button></View>:<ReviewAccessForm key={formKey} onSubmit={(u,p)=>run(()=>loginReview(u,p))} onBack={()=>void exit(true)}/>}</>;
}
