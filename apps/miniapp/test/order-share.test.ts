import {describe,it,expect,vi} from 'vitest';
import {parseSharedOrderId, internalCard, resolveInternalOrder} from '../src/lib/order-share';
const id='78af070b-8d5a-4fb2-ae48-4577ca41ac0b';
describe('internal order share access boundary',()=>{
 it('rejects arbitrary URLs, extra query and malformed IDs',()=>{for(const value of [undefined,'https://example.org',`${id}&role=ADMIN`,`${id}/../x`,''])expect(parseSharedOrderId(value)).toBeNull();expect(parseSharedOrderId(id)).toBe(id);});
 it('does not expose business content in the native card',()=>{const card=internalCard(id,true,'/fixed.png');expect(card).toEqual({title:'永盛集团质检平台 · 订单协作',path:'/pages/order-share/index?id=78af070b-8d5a-4fb2-ae48-4577ca41ac0b',imageUrl:'/fixed.png'});expect(internalCard(id,false,'/fixed.png').path).toBe('/pages/index/index');});
 it('never reads an order before employee binding',async()=>{const read=vi.fn();expect(await resolveInternalOrder(id,{isCurrentReal:()=>true,login:async()=> 'NEED_BIND',read})).toEqual({kind:'bind',id});expect(read).not.toHaveBeenCalled();});
 it('retains the original target only after authenticated permission check',async()=>{const events:string[]=[];const result=await resolveInternalOrder(id,{isCurrentReal:()=>true,login:async()=>{events.push('login');return 'READY';},read:async target=>{events.push(target);}});expect(events).toEqual(['login',id]);expect(result).toEqual({kind:'open',id});});
 it('does not request real order from demo or after identity change',async()=>{const read=vi.fn();expect((await resolveInternalOrder(id,{isCurrentReal:()=>false,login:async()=> 'READY',read})).kind).toBe('switch');let real=true;expect((await resolveInternalOrder(id,{isCurrentReal:()=>real,login:async()=>{real=false;return 'READY';},read})).kind).toBe('switch');expect(read).not.toHaveBeenCalled();});
 it('does not leak backend permission details on rejection',async()=>{expect(await resolveInternalOrder(id,{isCurrentReal:()=>true,login:async()=> 'READY',read:async()=>{throw Error('private customer data');}})).toEqual({kind:'unavailable'});});
});
