import { requestIdMiddleware } from './request-id.middleware';

it('保留常规请求标识，拒绝将疑似分享令牌作为请求标识',()=>{
 for(const [incoming,retained] of [['client-12345678',true],['a'.repeat(43),false]]){
  const req={header:()=>incoming} as never;const res={setHeader:jest.fn()} as never;const next=jest.fn();requestIdMiddleware(req,res,next);
  const output=(res as unknown as {setHeader:jest.Mock}).setHeader.mock.calls[0][1];
  if(retained)expect(output).toBe(incoming);else expect(output).not.toBe(incoming);expect(next).toHaveBeenCalled();
 }
});
