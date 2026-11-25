import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {PageHeader,QueryState} from '@/components/common';
import {api} from '@/lib/api';
import {useAuth} from '@/lib/auth';
import {useAction} from '@/lib/hooks';
import {noticeRoute} from '@/lib/notice-route';
interface Notice{id:string;title:string;body:string;createdAt:string;readAt:string|null;pagePath:string|null}
export function NotificationsPage(){const {me}=useAuth();const nav=useNavigate();const qc=useQueryClient();const q=useQuery({queryKey:['notifications',me?.id],queryFn:()=>api.get<{items:Notice[]}>('/notifications?page=1&pageSize=100')});const reload=()=>void qc.invalidateQueries({queryKey:['notifications']});const readAll=useAction(()=>api.post('/notifications/read-all',{}),{onSuccess:reload});const open=useAction(async(n:Notice)=>{if(!n.readAt)await api.post(`/notifications/${n.id}/read`,{});return noticeRoute(n.pagePath);},{onSuccess:path=>{reload();if(path)nav(path);}});return <><PageHeader title="工作通知" actions={<Button variant="outline" loading={readAll.isPending} onClick={()=>readAll.mutate(undefined)}>全部已读</Button>}/><QueryState q={q}><div className="space-y-3">{q.data?.items.map(n=><Card key={n.id}><CardContent className="space-y-2 p-5"><div className="flex justify-between"><h2 className="font-semibold">{n.title}</h2>{!n.readAt&&<span className="text-primary">未读</span>}</div><p>{n.body}</p><p className="text-sm text-muted-foreground">{new Date(n.createdAt).toLocaleString('zh-CN')}</p><Button variant="outline" loading={open.isPending} onClick={()=>open.mutate(n)}>{noticeRoute(n.pagePath)?'查看详情':'标记已读'}</Button></CardContent></Card>)}{q.data?.items.length===0&&<p>暂无消息</p>}</div></QueryState></>;}
