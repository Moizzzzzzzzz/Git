export interface OrderHomeSearchState<T>{query:string;items:T[]|null;loading:boolean;error:string}
/** Search the full server-authorized scope; never treat homepage rows as the result set. */
export function createOrderHomeSearch<T>(deps:{get:(path:string)=>Promise<{items:T[]}>;isCurrent:()=>boolean;publish:(state:OrderHomeSearchState<T>)=>void}){
 let state:OrderHomeSearchState<T>={query:'',items:null,loading:false,error:''};let serial=0;let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const current=(request:number)=>!disposed&&request===serial&&deps.isCurrent();
 function cancel(){serial++;if(timer!==undefined)clearTimeout(timer);timer=undefined;}
 function publish(next:OrderHomeSearchState<T>){state=next;if(!disposed&&deps.isCurrent())deps.publish(next);}
 async function run(request:number){if(!current(request)||!state.query.trim())return;const keyword=state.query.trim();try{const result=await deps.get(`/orders?q=${encodeURIComponent(keyword)}`);if(current(request))publish({...state,items:result.items,loading:false,error:''});}catch{if(current(request))publish({...state,items:null,loading:false,error:'搜索暂时不可用，请重试'});}}
 function input(query:string){cancel();publish({query,items:null,loading:!!query.trim(),error:''});if(query.trim()){const request=serial;timer=setTimeout(()=>{timer=undefined;void run(request);},300);}}
 function submit(){cancel();if(!state.query.trim()){publish({...state,items:null,loading:false,error:''});return;}publish({...state,items:null,loading:true,error:''});void run(serial);}
 function dispose(){disposed=true;cancel();}
 return {input,submit,dispose};
}
