import {Button,View} from '@tarojs/components';
import Taro,{useRouter} from '@tarojs/taro';
import {useEffect,useRef,useState} from 'react';
import {ensureLogin} from '@/lib/auth';
import {requestScoped} from '@/lib/api';
import {currentContext,contextPhase,sameIdentity} from '@/lib/session-context';
import {returnToReal} from '@/lib/demo-session';
import {parseSharedOrderId,resolveInternalOrder} from '@/lib/order-share';
export default function SharedOrder(){
 const id=parseSharedOrderId(useRouter().params.id);const [status,setStatus]=useState('正在核对访问权限…');const [needsReal,setNeedsReal]=useState(false);const busy=useRef(false),alive=useRef(true);
 async function open(){if(busy.current)return;busy.current=true;setStatus('正在核对访问权限…');const origin=currentContext();
  const result=await resolveInternalOrder(id,{isCurrentReal:()=>alive.current&&origin.kind==='real'&&contextPhase()==='ready'&&sameIdentity(origin),login:ensureLogin,read:target=>requestScoped(origin,'GET',`/orders/${target}`,undefined,false)});
  busy.current=false;if(!alive.current)return;
  if(result.kind==='switch'){setNeedsReal(true);setStatus('请切回本人身份后查看同事分享的订单。');return;}
  if(result.kind==='unavailable'){setStatus('暂时无法打开订单，请确认员工身份和访问权限后重试。');return;}
  const url=result.kind==='bind'?`/pages/bind/index?orderId=${result.id}`:`/pages/orders/detail?id=${result.id}`;
  try{await Taro.redirectTo({url});}catch{setStatus('暂时无法打开订单，请重试。');}
 }
 async function switchBack(){if(busy.current)return;busy.current=true;try{await returnToReal();await Taro.reLaunch({url:id?`/pages/order-share/index?id=${id}`:'/pages/index/index'});}catch{setStatus('暂时无法切回本人，请在设置中恢复身份后重试。');}finally{busy.current=false;}}
 useEffect(()=>{void open();return()=>{alive.current=false;};},[]);
 return <View className="container"><View className="page-intro-title">订单协作</View><View className="card"><View>{status}</View>{needsReal?<Button className="btn secondary" onClick={()=>void switchBack()}>切回本人</Button>:<Button className="btn secondary" onClick={()=>void open()}>重试</Button>}<Button className="btn secondary" onClick={()=>Taro.reLaunch({url:'/pages/index/index'})}>返回首页</Button></View></View>;
}
