import {formatBeijingTime} from '@/lib/report-format';
import {Button,View} from '@tarojs/components';
import Taro,{useRouter} from '@tarojs/taro';
import {useEffect,useRef,useState} from 'react';
import {usePageDidShow} from '@/lib/use-page-show';
import {CUSTOMER_SHARE_UNAVAILABLE,readCustomerShare,downloadCustomerShare,type CustomerReportSummary} from '@/lib/customer-share';
/** No employee boundary/login/header on the bearer-card customer page. */
export default function CustomerShare(){
 const token=useRouter().params.t??'';const [data,setData]=useState<CustomerReportSummary|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const alive=useRef(true);const downloading=useRef(false);const readEpoch=useRef(0);
 async function load(){const epoch=++readEpoch.current;setData(null);setError('');try{const result=await readCustomerShare(token);if(alive.current&&epoch===readEpoch.current)setData(result);}catch{if(alive.current&&epoch===readEpoch.current)setError(CUSTOMER_SHARE_UNAVAILABLE);}}
 async function pdf(){if(downloading.current)return;downloading.current=true;setBusy(true);setError('');try{const path=await downloadCustomerShare(token);if(alive.current)await Taro.openDocument({filePath:path,fileType:'pdf',showMenu:true});}catch{if(alive.current){setData(null);setError(CUSTOMER_SHARE_UNAVAILABLE);}}finally{downloading.current=false;if(alive.current)setBusy(false);}}
 usePageDidShow(()=>void load());
 useEffect(()=>()=>{alive.current=false;readEpoch.current++;},[]);
 const pendingActions=Array.isArray(data?.report.pendingActions)?data.report.pendingActions.filter((text):text is string=>typeof text==='string'&&text.trim().length>0):[];
 return <View className="container"><View className="page-intro-title">验布报告</View>{error?<View className="card"><View>{error}</View><Button className="btn secondary" onClick={()=>void load()}>重新查看</Button></View>:data?<View className="card"><View className="card-title">{data.report.hNo}</View><View>主管已确认</View><View>报告版本 {data.reportVersion}</View><View>确认时间 {formatBeijingTime(data.report.confirmedAt)}</View><View>{pendingActions.length>0&&<View style={{marginTop:'20px'}}><View className="label">待处理事项</View>{pendingActions.map((text,n)=><View key={n}>{text}</View>)}</View>}</View><Button className="btn" disabled={busy} loading={busy} onClick={()=>void pdf()}>查看报告</Button></View>:<View className="empty">正在读取报告…</View>}</View>;
}
