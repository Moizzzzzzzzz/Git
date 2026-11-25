import {describe,expect,it} from 'vitest';
import {formatBeijingTime,frozenMeasurementUnit} from '../src/lib/report-format';
describe('frozen report display',()=>{
 it('renders Z and explicit +08 instants as the same Beijing time',()=>{expect(formatBeijingTime('2026-11-12T06:41:58.000Z')).toBe('2026-11-12 14:41（北京时间）');expect(formatBeijingTime('2026-11-12T14:41:58+08:00')).toBe('2026-11-12 14:41（北京时间）');});
 it('does not invent a time for invalid or timezone-less values',()=>{for(const value of ['', 'invalid','2026-13-12T14:41:00Z','2026-11-12 14:41'])expect(formatBeijingTime(value)).toBe('确认时间未记录');});
 it('uses the unit from each frozen template even if the key is identical',()=>{expect(frozenMeasurementUnit({measurements:[{key:'width',unit:'cm'}]},'width')).toBe('cm');expect(frozenMeasurementUnit({measurements:[{key:'width',unit:'mm'}]},'width')).toBe('mm');});
 it('reports missing snapshot units without guessing',()=>{expect(frozenMeasurementUnit(undefined,'width')).toBe('单位未记录');expect(frozenMeasurementUnit({measurements:[]},'gsm')).toBe('单位未记录');});
});
