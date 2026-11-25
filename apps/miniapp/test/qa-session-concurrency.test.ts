import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({storage:new Map<string,unknown>(),calls:[] as string[],respond:async(_r:{url:string;header?:Record<string,string>}):Promise<{statusCode:number;data:unknown}>=>({statusCode:200,data:{}}),relaunch:vi.fn()}));
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:(k:string)=>h.storage.get(k),setStorageSync:(k:string,v:unknown)=>h.storage.set(k,v),removeStorageSync:(k:string)=>h.storage.delete(k),request:(r:{url:string;header?:Record<string,string>})=>{h.calls.push(new URL(r.url).pathname);return h.respond(r)},reLaunch:h.relaunch}}));
vi.mock('../src/lib/config',()=>({API_BASE_URL:'http://test'}));
beforeEach(()=>{vi.resetModules();h.storage.clear();h.calls.length=0;h.relaunch.mockClear()});
it('two simultaneous expired business requests share one refresh and each retries with renewed identity',async()=>{
 const api=await import('../src/lib/api');api.saveTokens({accessToken:'old',refreshToken:'refresh'});
 let release!:(r:{statusCode:number;data:unknown})=>void;
 h.respond=r=>r.url.endsWith('/auth/refresh')?new Promise(resolve=>{release=resolve}):Promise.resolve(r.header?.Authorization==='Bearer old'?{statusCode:401,data:{}}:{statusCode:200,data:{ok:true}});
 const a=api.request('GET','/tasks');const b=api.request('GET','/tasks');
 await vi.waitFor(()=>expect(h.calls.filter(x=>x==='/auth/refresh')).toHaveLength(1));release({statusCode:200,data:{accessToken:'new',refreshToken:'PUBLIC_REDACTED'}});
 expect(await Promise.all([a,b])).toEqual([{ok:true},{ok:true}]);expect(h.calls.filter(x=>x==='/auth/refresh')).toHaveLength(1);expect(h.relaunch).not.toHaveBeenCalled();
});
it.each([429,503])('business request %s preserves session and does not refresh or relaunch',async status=>{
 const api=await import('../src/lib/api');api.saveTokens({accessToken:'old',refreshToken:'refresh'});h.storage.set('draft','kept');h.respond=async()=>({statusCode:status,data:{}});
 await expect(api.request('GET','/tasks')).rejects.toMatchObject({status});expect(h.calls).toEqual(['/tasks']);expect(h.storage.get('fqc_refresh')).toBe('refresh');expect(h.storage.get('draft')).toBe('kept');expect(h.relaunch).not.toHaveBeenCalled();
});
