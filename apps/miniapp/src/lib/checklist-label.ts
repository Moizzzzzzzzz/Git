export interface FrozenRuleSource {ruleSource?:'FACTORY'|'CUSTOMER'|null;fourPoint?:{rules?:unknown};customer?:{rules?:unknown}|null}
export function isFormalLabelItem(standards:FrozenRuleSource|undefined,key:string):boolean {
 const rules=standards?.ruleSource==='CUSTOMER'?standards.customer?.rules:standards?.fourPoint?.rules;
 return key==='label_match'&&typeof rules==='object'&&rules!==null&&'formalProfile' in rules&&rules.formalProfile==='YONGSHENG_2026';
}
export function checklistNaLabel(standards:FrozenRuleSource|undefined,key:string){return isFormalLabelItem(standards,key)?'无法核对':'不适用';}
export function formalLabelReasonError(standards:FrozenRuleSource|undefined,items:readonly {key:string;status:string;note?:string|null}[]):string|null {
 if(!isFormalLabelItem(standards,'label_match'))return null;
 const label=items.find(item=>item.key==='label_match');
 return label?.status==='NA'&&!label.note?.trim()?'卷标无法核对时请填写实际原因':null;
}
