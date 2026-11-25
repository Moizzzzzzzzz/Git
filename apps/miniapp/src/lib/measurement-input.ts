export interface MeasurementReading { itemKey:string;seq:number;value:number }
/** Blank rows are view state; only actual readings are synchronized and counted for submission. */
export function measurementRowCount(minReadings:number,readings:readonly {seq:number}[],visibleCount:number){
 return Math.max(minReadings,visibleCount,...readings.map(r=>r.seq));
}
export function withMeasurementReading(readings:readonly MeasurementReading[],itemKey:string,seq:number,text:string):MeasurementReading[]{
 const next=readings.filter(r=>r.itemKey!==itemKey||r.seq!==seq);
 const value=text.trim()===''?null:Number(text);
 if(value!==null&&Number.isFinite(value))next.push({itemKey,seq,value});
 return next;
}
