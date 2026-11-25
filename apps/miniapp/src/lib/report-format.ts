/** The API timestamp must carry its timezone; render the same instant in UTC+08:00. */
export function formatBeijingTime(value:string){
 if(!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))return '确认时间未记录';
 const instant=Date.parse(value);
 if(!Number.isFinite(instant))return '确认时间未记录';
 return `${new Date(instant+8*60*60*1000).toISOString().slice(0,16).replace('T',' ')}（北京时间）`;
}
/** Resolve only against this report's frozen template, never current configuration. */
export function frozenMeasurementUnit(template:{measurements:readonly {key:string;unit?:string|null}[]}|null|undefined,key:string){
 return template?.measurements.find(item=>item.key===key)?.unit?.trim()||'单位未记录';
}
