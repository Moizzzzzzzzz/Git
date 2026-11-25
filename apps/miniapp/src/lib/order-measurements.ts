/** Empty form fields mean unchanged; only an explicit clear sends null. */
export function measurementInput(length:string,weight:string){
 const values:{measuredLengthM?:string;measuredWeightKg?:string}={};
 if(length.trim()){if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(length.trim())||Number(length)<=0)throw new Error('米数请填写大于零的数字，最多两位小数');values.measuredLengthM=length.trim();}
 if(weight.trim()){if(!/^\d{1,7}(?:\.\d{1,3})?$/.test(weight.trim())||Number(weight)<=0)throw new Error('重量请填写大于零的数字，最多三位小数');values.measuredWeightKg=weight.trim();}
 if(!Object.keys(values).length)throw new Error('请至少填写一项实测值');
 return values;
}
