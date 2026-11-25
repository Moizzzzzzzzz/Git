import {expect,it} from 'vitest';
import {requiresControlledConfiguration} from './standard-editor';
it('keeps historical unprofiled rules editable',()=>{expect(requiresControlledConfiguration({schemaVersion:1,fourPoint:{areaUnit:'PER_100_SQ_YD'}})).toBe(false);});
it('does not downgrade a formal profile through the simple editor, including unrecognized future profiles',()=>{expect(requiresControlledConfiguration({formalProfile:'YONGSHENG_2026'})).toBe(true);expect(requiresControlledConfiguration({formalProfile:'FUTURE'})).toBe(true);});
