import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({state:null as {seq:number;text:string}|null}));
vi.mock('react',()=>({useState:()=>[h.state,(next:typeof h.state)=>{h.state=next;}]}));
import {useMeasurementEditor} from '../src/lib/use-measurement-editor';
beforeEach(()=>{h.state=null;});
it('persists each keystroke before blur and keeps raw decimal during a parent refresh',()=>{
 const save=vi.fn();let editor=useMeasurementEditor([{seq:1,value:180}],save);
 editor.input(1,'1');editor=useMeasurementEditor([],save);editor.input(1,'18');editor=useMeasurementEditor([],save);editor.input(1,'180.');
 editor=useMeasurementEditor([{seq:1,value:180}],save);
 expect(save.mock.calls).toEqual([[1,'1'],[1,'18'],[1,'180.']]);expect(editor.value(1)).toBe('180.');
 editor.input(1,'180.5');editor=useMeasurementEditor([],save);expect(editor.value(1)).toBe('180.5');
 editor.blur(1,'180.5');editor=useMeasurementEditor([{seq:1,value:180.5}],save);expect(editor.value(1)).toBe('180.5');
});
it('keeps empty/incomplete text distinct and a new mounted scope has no previous input',()=>{
 const save=vi.fn();let editor=useMeasurementEditor([{seq:1,value:180}],save);
 editor.input(1,'');editor=useMeasurementEditor([{seq:1,value:180}],save);expect(editor.value(1)).toBe('');
 editor.input(1,'.');editor=useMeasurementEditor([],save);expect(editor.value(1)).toBe('.');expect(save).toHaveBeenLastCalledWith(1,'.');
 h.state=null;editor=useMeasurementEditor([{seq:1,value:145}],save);expect(editor.value(1)).toBe('145');
});
