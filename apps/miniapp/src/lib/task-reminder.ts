/** The API owns eligibility and five-minute cooldown. Keep a key after an ambiguous failure. */
export function createTaskReminder(send:(id:string,key:string)=>Promise<unknown>,newKey:()=>string){
 const keys:Record<string,string>={};let busy=false;
 return {get busy(){return busy;},async run(id:string){if(busy)return false;busy=true;const key=keys[id]??(keys[id]=newKey());try{await send(id,key);keys[id]=newKey();return true;}finally{busy=false;}}};
}
