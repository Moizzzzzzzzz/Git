import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({events:[] as string[],login:vi.fn(),launch:vi.fn()}));
vi.mock('@tarojs/taro',()=>({default:{reLaunch:h.launch}}));
vi.mock('../src/lib/auth',()=>({ensureLogin:h.login}));
beforeEach(()=>{vi.resetModules();h.events=[];h.login.mockReset().mockImplementation(async()=>{h.events.push('verified');return 'READY';});h.launch.mockReset().mockImplementation(async()=>{h.events.push('launch');});});
it('verifies new identity before launching Taro home so its initial show is not missed',async()=>{const {finishDemoTransition}=await import('../src/lib/demo-navigation');await finishDemoTransition(async()=>{h.events.push('committed');});expect(h.events).toEqual(['committed','verified','launch']);expect(h.launch).toHaveBeenCalledWith({url:'/pages/index/index'});});
it('failed identity verification keeps the transition page instead of launching a stale home',async()=>{const {finishDemoTransition}=await import('../src/lib/demo-navigation');h.login.mockRejectedValueOnce(Error('unavailable'));await expect(finishDemoTransition(async()=>{})).rejects.toThrow('unavailable');expect(h.launch).not.toHaveBeenCalled();});
