import {describe,expect,it} from 'vitest';
import {filterSchemes,schemeScopeText} from '../src/lib/scheme-options';
const items=[{id:'w',name:'梭织',applicability:{structure:['WOVEN'] as const,fiber:['POLYESTER'] as const}},{id:'k',name:'针织',applicability:{structure:['KNIT'] as const,fiber:['NYLON'] as const}},{id:'old',name:'旧方案'}];
describe('scheme applicability is not fabric composition',()=>{
 it('filters both dimensions and keeps unclassified separate',()=>{const r=filterSchemes(items,{structure:'KNIT',fiber:'NYLON'});expect(r.matched.map(x=>x.id)).toEqual(['k']);expect(r.unclassified.map(x=>x.id)).toEqual(['old']);});
 it('does not silently match missing ranges',()=>{const r=filterSchemes(items,{structure:'',fiber:''});expect(r.matched).toHaveLength(2);expect(r.unclassified).toHaveLength(1);expect(schemeScopeText(undefined)).toBe('适用范围未标注');});
 it('supports multi value ranges without inferring percentages',()=>{expect(schemeScopeText({structure:['KNIT','WOVEN'],fiber:['POLYESTER','NYLON']})).toBe('针织 / 梭织 · 涤纶 / 锦纶');});
});
