import { usePageApi } from '@/lib/use-page-context';
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { currentMe, hasRole } from '@/lib/auth';
import { parseRollNumbers } from '@/lib/business-workflow';
export interface WorkflowTask {id:string;origin?:string;supervisorId?:string|null;assigneeId?:string|null;assignee?:{id:string;name:string}|null;plannedRollCount?:number|null;delivery?:{id:string;confirmedAt:string}|null;rolls:{latestInspection:{status:string}|null}[]}
export default function TaskWorkflowControls({task:t,onChanged}:{task:WorkflowTask;onChanged:()=>Promise<void>}) {
 const api=usePageApi();
 const supervisor=hasRole('QC_SUPERVISOR')&&currentMe()?.id===t.supervisorId;
 const inspector=hasRole('INSPECTOR')&&currentMe()?.id===(t.assigneeId??t.assignee?.id);
 const [people,setPeople]=useState<{id:string;name:string}[]>([]); const [fabrics,setFabrics]=useState<{id:string;code:string;nameZh:string}[]>([]);
 const [person,setPerson]=useState(''); const [fabric,setFabric]=useState(''); const [rolls,setRolls]=useState(''); const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{if(t.origin!=='BUSINESS'||t.delivery)return;const jobs:Promise<unknown>[]=[];if(supervisor)jobs.push(api.get<{id:string;name:string}[]>('/users/options?role=INSPECTOR').then(r=>setPeople(r.filter(x=>x.id!==t.supervisorId))));if(inspector)jobs.push(api.get<{items:{id:string;code:string;nameZh:string}[]}>('/fabrics?pageSize=200').then(r=>setFabrics(r.items)));Promise.all(jobs).catch(e=>setError(errorText(e)));},[t.id,t.delivery?.id,supervisor,inspector]);
 async function action(fn:()=>Promise<unknown>,message:string){if(busy)return;setBusy(true);setError('');try{await fn();await onChanged();await Taro.showToast({title:message,icon:'none'});}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function confirm(){const r=await Taro.showModal({title:'确认整单验布结果？',content:'确认后，本部门可查看整单详情和照片，并为发起业务员生成通知。确认记录准确不代表布料全部合格，交付后不可原地修改。'});if(r.confirm)await action(()=>api.post(`/tasks/${t.id}/delivery`,{}),'整单结果已确认');}
 const ready=!!t.plannedRollCount&&t.rolls.length===t.plannedRollCount&&t.rolls.every(r=>r.latestInspection?.status==='APPROVED');
 if(t.origin!=='BUSINESS')return null;
 return <View className="card workflow-controls"><View className="card-title">计划 {t.plannedRollCount} / 已登记 {t.rolls.length} 卷</View>{error&&<View className="error-box">{error}</View>}{t.delivery?<View className="tag success">整单已确认，交付版本已固定</View>:<>
 {supervisor&&<View><View className="field"><View className="label">{t.assignee?'更换质检跟单员':'分发给一位质检跟单员'}</View><Picker mode="selector" range={people.map(x=>x.name)} value={Math.max(0,people.findIndex(x=>x.id===person))} onChange={e=>setPerson(people[Number(e.detail.value)]?.id??'')}><View className={`picker-value${person ? '' : ' is-placeholder'}`}>{people.find(x=>x.id===person)?.name??'请选择跟单员'}</View></Picker></View><Input placeholderClass="field-placeholder" className="input" value={reason} onInput={e=>setReason(e.detail.value)} placeholder="改派说明（选填）"/><Button className="btn secondary" disabled={busy||!person||person===(t.assigneeId??t.assignee?.id)} loading={busy} onClick={()=>void action(()=>api.post(`/tasks/${t.id}/assignment`,{assigneeId:person,reason:reason.trim()||undefined}),'任务已分发')}>{t.assignee?'确认改派':'确认分发'}</Button><View className="muted">活动草稿和退回记录需先处理，已提交记录保留原验布人。</View></View>}
 {inspector&&<View><View className="field"><View className="label">登记布卷所用面料</View><Picker mode="selector" range={fabrics.map(x=>`${x.code} ${x.nameZh}`)} value={Math.max(0,fabrics.findIndex(x=>x.id===fabric))} onChange={e=>setFabric(fabrics[Number(e.detail.value)]?.id??'')}><View className={`picker-value${fabric ? '' : ' is-placeholder'}`}>{fabrics.find(x=>x.id===fabric)?.code??'请选择面料'}</View></Picker></View><View className="field"><View className="label">补录卷号（每行一个）</View><Textarea placeholderClass="field-placeholder" className="textarea" value={rolls} onInput={e=>setRolls(e.detail.value)}/></View><Button className="btn secondary" disabled={busy||!fabric||!rolls.trim()} loading={busy} onClick={()=>void action(async()=>{const r=await api.post(`/tasks/${t.id}/rolls/register`,{fabricId:fabric,rolls:parseRollNumbers(rolls).map(rollNo=>({rollNo}))});setRolls('');return r;},'卷号已登记')}>登记卷号</Button></View>}
 {supervisor&&<View style={{marginTop:'24px'}}><Text className="muted">每卷结果确认后，才能确认整单；布料不合格也可确认准确的检验结果。</Text><Button className="btn" disabled={!ready||busy} loading={busy} onClick={()=>void confirm()}>整单确认</Button>{!ready&&<View className="muted">尚未完成全部计划卷的登记与审核</View>}</View>}
 </>}</View>;
}
