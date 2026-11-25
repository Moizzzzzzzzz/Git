import type {OrderCustomerOptions} from './orders';
export function customerConfigurationInput(canConfigure:boolean|undefined,version:number,options:OrderCustomerOptions|null|undefined,customerId:string,customerStandardId:string,restoreFactory=false){
 if(canConfigure!==true)throw new Error('当前账号无权配置本单客户标准');
 if(restoreFactory)return {version,customerId:null,customerStandardId:null};
 if(!options?.customers.some(c=>c.id===customerId))throw new Error('请选择有权配置的客户');
 const standard=options.customerStandards.find(s=>s.id===customerStandardId&&s.customer?.id===customerId&&!!s.currentVersion?.id);
 if(!standard)throw new Error('请选择该客户已发布的完整标准');
 return {version,customerId,customerStandardId};
}
