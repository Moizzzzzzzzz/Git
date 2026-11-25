/** VCANS rolls may have no master fabric. Never synthesize a missing material code. */
export interface FabricDisplay {fabric?:{code?:string|null;nameZh?:string|null}|null;orderLine?:{productCode?:string|null;productName?:string|null}|null}
export const fabricCode=(r:FabricDisplay)=>r.fabric?.code??r.orderLine?.productCode??'';
export const fabricName=(r:FabricDisplay)=>r.fabric?.nameZh??r.orderLine?.productName??'';
