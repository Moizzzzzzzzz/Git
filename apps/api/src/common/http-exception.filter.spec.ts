import { AllExceptionsFilter } from './http-exception.filter';

function invoke(originalUrl:string,path:string,stack:string,requestId:string,route?:string) {
 const f=new AllExceptionsFilter();const error=jest.fn();Object.defineProperty(f,'logger',{value:{error}});
 const response={status:jest.fn().mockReturnThis(),json:jest.fn()};
 const req={method:'GET',originalUrl,path,requestId,route:route?{path:route}:undefined};
 const host={switchToHttp:()=>({getResponse:()=>response,getRequest:()=>req})};
 f.catch(Object.assign(new Error('failure'),{stack}),host as never);return {error,response};
}
it('普通路由5xx不记录query、疑似分享令牌或异常原文，保留路由模板和调用位置',()=>{
 const secret=`ysr_${'z'.repeat(43)}`;const r=invoke(`/api/orders/1?q=${secret}`,'/api/orders/1',`Error: injected ${secret}\n    at service (/safe/app.js:20:4)\n    at suspect (/safe/${secret}.js:21:2)`,secret,'/api/orders/:id');
 const output=JSON.stringify(r.error.mock.calls);expect(output).not.toContain(secret);expect(output).not.toContain('?q=');expect(output).not.toContain('injected');expect(output).toContain('/api/orders/:id');expect(output).toContain('app.js:20:4');expect(output).not.toContain('/safe/');
});
it('分享路由5xx不记录原文或请求头内容，仍返回通用错误',()=>{
 const secret=`ysr_${'y'.repeat(43)}`;const r=invoke(`/api/customer-shares/current?token=${secret}`,'/api/customer-shares/current',`Error: ${secret}`,secret,'/api/customer-shares/current');
 expect(JSON.stringify(r.error.mock.calls)).not.toContain(secret);expect(r.response.status).toHaveBeenCalledWith(500);
});
