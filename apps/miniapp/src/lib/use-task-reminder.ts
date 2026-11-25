import {usePageApi} from './use-page-context';
import { useRef, useState } from 'react';
import { errorText } from './api';
import { uuid } from './uuid';
import { createTaskReminder } from './task-reminder';
export function useTaskReminder(){
 const api=usePageApi();
 const controller=useRef<ReturnType<typeof createTaskReminder>|null>(null);
 if(!controller.current)controller.current=createTaskReminder((id,key)=>api.post(`/tasks/${id}/reminders`,{idempotencyKey:key}),uuid);
 const [busyId,setBusyId]=useState<string|null>(null);const [notice,setNotice]=useState('');
 async function remind(id:string){const request=controller.current!;if(request.busy)return;setBusyId(id);setNotice('');try{await request.run(id);setNotice('催审提醒已记录');}catch(e){setNotice(errorText(e));}finally{setBusyId(null);}}
 return {busyId,notice,remind};
}
