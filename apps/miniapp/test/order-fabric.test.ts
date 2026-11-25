import {expect,it} from 'vitest';
import {fabricCode,fabricName} from '../src/lib/fabric-display';
it('uses the real imported line when master fabric is absent, without inventing a code',()=>{const roll={fabric:null,orderLine:{productCode:null,productName:'棉坯布'}};expect(fabricCode(roll)).toBe('');expect(fabricName(roll)).toBe('棉坯布');expect(fabricName({fabric:null})).toBe('');});
it('preserves existing master fabric labels',()=>{expect(fabricCode({fabric:{code:'YS-01',nameZh:'面料'}})).toBe('YS-01');});
