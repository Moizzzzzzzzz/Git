import {it,expect} from 'vitest';
import {measurementInput} from '../src/lib/order-measurements';
it('does not erase or fabricate the other quantity when only one actual value is entered',()=>{expect(measurementInput('8.25','')).toEqual({measuredLengthM:'8.25'});expect(measurementInput('','1.234')).toEqual({measuredWeightKg:'1.234'});});
it('enforces metre and kg precision separately and rejects missing or negative values',()=>{for(const values of [['',''],['1.234',''],['','1.2345'],['-1',''],['0',''],['','0']] as const)expect(()=>measurementInput(...values)).toThrow();});
