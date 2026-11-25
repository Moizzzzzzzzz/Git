import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ConfirmButton } from '@/components/common';
import { api, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { parseRollNumbers } from '@/lib/business-workflow';
import { usePeople, type TaskRow } from './TasksPage';

type Task = TaskRow & { rolls:{ latestInspection:{status:string}|null }[] };
export function BusinessQcControls({task:t}:{task:Omit<Task,'rollCount'|'doneCount'|'submittedCount'>}) {
 const {me,can}=useAuth(); const supervisor=can('QC_SUPERVISOR')&&me?.id===t.supervisorId;
 const inspector=can('INSPECTOR')&&me?.id===t.assignee?.id;
 const [assigneeId,setAssignee]=useState(t.assignee?.id??''); const [reason,setReason]=useState('');
 const [fabricId,setFabric]=useState(''); const [rollNumbers,setRollNumbers]=useState('');
 const people=usePeople('INSPECTOR', supervisor && !t.delivery);
 const fabrics=useQuery({queryKey:['task-fabric-options'],queryFn:()=>api.get<Paged<{id:string;code:string;nameZh:string}>>('/fabrics?pageSize=200'),enabled:inspector&&!t.delivery});
 const invalidate=[['task',t.id],['tasks']];
 const assign=useAction(()=>api.post(`/tasks/${t.id}/assignment`,{assigneeId,reason:reason.trim()||undefined}),{success:'任务已分发给跟单员',invalidate});
 const register=useAction(()=>api.post(`/tasks/${t.id}/rolls/register`,{fabricId,rolls:parseRollNumbers(rollNumbers).map(rollNo=>({rollNo}))}),{success:'卷号已登记',invalidate,onSuccess:()=>setRollNumbers('')});
 const deliver=useAction(()=>api.post(`/tasks/${t.id}/delivery`,{}),{success:'整单验布结果已确认，通知已生成',invalidate});
 const ready=!!t.plannedRollCount&&t.rolls.length===t.plannedRollCount&&t.rolls.every(r=>r.latestInspection?.status==='APPROVED');
 return <Card><CardContent className="space-y-4 p-5"><div className="font-semibold">业务部门验布任务 · 计划 {t.plannedRollCount} 卷 / 已登记 {t.rolls.length} 卷</div>{t.delivery?<p>整单已确认，交付结果已固定。</p>:<>
 {supervisor&&<div className="grid gap-3 md:grid-cols-3"><Field label={t.assignee?'更换质检跟单员':'分发给质检跟单员'}><NativeSelect placeholderShown={!assigneeId} value={assigneeId} onChange={e=>setAssignee(e.target.value)}><option value="">请选择一位跟单员</option>{people.data?.filter(p=>p.id!==t.supervisorId).map(p=><option value={p.id} key={p.id}>{p.name}（{p.employeeNo}）</option>)}</NativeSelect></Field><Field label="改派说明（选填）"><Input value={reason} onChange={e=>setReason(e.target.value)}/></Field><div className="self-end"><Button loading={assign.isPending} disabled={!assigneeId||assigneeId===t.assignee?.id} onClick={()=>assign.mutate(undefined)}>{t.assignee?'确认改派':'确认分发'}</Button></div></div>}
 {supervisor&&<p className="text-xs text-muted-foreground">有进行中或退回待修改的记录时，需先处理完毕再改派，已有提交记录保留原验布人。</p>}
 {inspector&&<div className="space-y-3 border-t pt-4"><Field label="登记布卷所用面料"><NativeSelect placeholderShown={!fabricId} value={fabricId} onChange={e=>setFabric(e.target.value)}><option value="">请选择面料</option>{fabrics.data?.items.map(f=><option value={f.id} key={f.id}>{f.code} {f.nameZh}</option>)}</NativeSelect></Field><Field label="补录卷号" hint="每行一个卷号，不得超过计划总卷数"><Textarea value={rollNumbers} onChange={e=>setRollNumbers(e.target.value)}/></Field><Button loading={register.isPending} disabled={!fabricId||!rollNumbers.trim()} onClick={()=>register.mutate(undefined)}>登记卷号</Button></div>}
 {supervisor&&<div className="space-y-2 border-t pt-4"><p className="text-sm">登记全部计划布卷并逐卷确认结果后，可确认整单。布料是否合格以各卷结果为准。</p><ConfirmButton disabled={!ready||deliver.isPending} title="确认整单验布结果？" description="确认后，本部门可查看验布详情、照片和报告，并为发起业务员生成微信通知。确认记录准确不代表所有布料合格，交付后不能原地修改。" onConfirm={()=>deliver.mutateAsync(undefined)}>整单确认</ConfirmButton>{!ready&&<p className="text-xs text-muted-foreground">当前尚未完成全部计划布卷的登记与审核。</p>}</div>}
 </>}</CardContent></Card>;
}
