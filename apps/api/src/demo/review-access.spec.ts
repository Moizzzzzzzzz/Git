import { JwtService } from '@nestjs/jwt';
import { hashPassword } from '../auth/password';
import { DemoSessionService } from './demo-session.service';
import { reviewRouteAllowed } from './review-route-policy';
import { validateDemoConfig } from './demo-safety';

function config(hash:string){return {DEMO_RUNTIME_MODE:'demo',REVIEW_MODE:true,REVIEW_ENABLED:true,REVIEW_USERNAME:'review-test',REVIEW_PASSWORD_HASH:hash,REVIEW_EXPIRES_AT:new Date(Date.now()+90*60*1000).toISOString(),REVIEW_REVISION:'r'.repeat(32),DEMO_SESSION_SECRET:'s'.repeat(32)};}
it('仅审核模式、正确账号密码产生p01候选，可提交、退出及按开关或代际即时撤销',async()=>{
 const hash=await hashPassword('synthetic-pass-123');const env=config(hash);let stored:Record<string,string>={};const store={createCandidate:jest.fn(async(c)=>{stored={state:'PENDING',chainId:c.chainId,personaId:c.personaId,actorId:c.actorId,resetVersion:c.resetVersion};return 'OK';}),get:jest.fn(async()=>stored),commit:jest.fn(async()=>{stored.state='ACTIVE';return 'ACTIVE';}),logout:jest.fn(async()=>{stored.state='REVOKED';return 'OK';})};const audit={log:jest.fn()};const svc=new DemoSessionService({env} as never,new JwtService(),store as never,audit as never);
 await expect(svc.reviewLogin('wrong','synthetic-pass-123')).rejects.toThrow();await expect(svc.reviewLogin('review-test','wrong')).rejects.toThrow();
 const s=await svc.reviewLogin('review-test','synthetic-pass-123');expect(s).toMatchObject({personaId:'p01',role:'SALES',sessionState:'PENDING'});expect(Date.parse(s.expiresAt)).toBeLessThanOrEqual(Date.parse(env.REVIEW_EXPIRES_AT));expect((await svc.me(s.accessToken)).sessionState).toBe('PENDING');await svc.commit(s.accessToken);expect((await svc.me(s.accessToken)).sessionState).toBe('ACTIVE');
 env.REVIEW_REVISION='t'.repeat(32);await expect(svc.me(s.accessToken)).rejects.toThrow();env.REVIEW_REVISION='r'.repeat(32);env.REVIEW_ENABLED=false;await expect(svc.me(s.accessToken)).rejects.toThrow();env.REVIEW_ENABLED=true;await svc.logout(s.accessToken);await expect(svc.me(s.accessToken)).rejects.toThrow();
 expect(JSON.stringify(audit.log.mock.calls)).not.toContain('synthetic-pass-123');expect(JSON.stringify(audit.log.mock.calls)).not.toContain(s.accessToken);
});
it('审核与普通演示令牌互不接纳',async()=>{
 const jwt=new JwtService(),hash=await hashPassword('synthetic-pass-123'),env=config(hash);const svc=new DemoSessionService({env} as never,jwt,{} as never,{} as never);
 const token=jwt.sign({sub:'13943a7e-f52a-4824-984c-1771fefbd6a4',sid:'a'.repeat(48),typ:'fqc_demo_access',personaId:'p01',chainId:'b'.repeat(64),resetVersion:'v1'},{secret:env.DEMO_SESSION_SECRET,algorithm:'HS256',issuer:'fabricqc-demo',audience:'fabricqc-demo-api',expiresIn:300});await expect(svc.me(token)).rejects.toThrow();
});
it('审核路由仅允许必需读取与会话控制，大小写及写入不能绕过',()=>{
 const id='123e4567-e89b-42d3-a456-426614174000';for(const [m,p] of [['POST','/api/review-access/login'],['POST','/api/demo/commit'],['POST','/api/demo/logout'],['GET','/api/demo/me'],['GET','/api/auth/me'],['GET','/api/orders'],['GET',`/api/orders/${id}`],['GET',`/api/orders/${id}/reports`],['GET',`/api/orders/${id}/reports/1/pdf`]])expect(reviewRouteAllowed(m,p)).toBe(true);
 for(const [m,p] of [['POST','/api/orders'],['GET','/api/customers'],['GET','/api/fabrics'],['GET','/api/orders/options'],['GET',`/api/orders/${id}/reports/1/pdf/extra`],['POST','/api/demo/exchange'],['GET','/API/orders']])expect(reviewRouteAllowed(m,p)).toBe(false);
});
it('审核隔离配置必须使用独立数据库、缓存、对象桶且无微信发送',async()=>{
 const hash=await hashPassword('synthetic-pass-123');const e={...config(hash),RUN_WORKERS:false,DEMO_ENTRY_ENABLED:false,DATABASE_URL:'postgresql://REDACTED:REDACTED@review-db/fabricqc_review',REDIS_URL:'redis://REDACTED:REDACTED@review-redis:6379',STORAGE_PROVIDER:'minio',STORAGE_ENDPOINT:'http://review-minio:9000',STORAGE_PUBLIC_ENDPOINT:'https://example.invalid',STORAGE_BUCKET:'review-media',STORAGE_ACCESS_KEY_ID:'review-key',STORAGE_SECRET_ACCESS_KEY:'PUBLIC_REDACTED',STORAGE_FORCE_PATH_STYLE:true,JWT_ACCESS_SECRET:'j'.repeat(32)};
 expect(()=>validateDemoConfig(e as never)).not.toThrow();for(const bad of [{RUN_WORKERS:true},{STORAGE_BUCKET:'demo-media'},{DATABASE_URL:'postgresql://REDACTED:REDACTED@demo-db/fabricqc_demo'},{WECHAT_APP_ID:'wx'},{DEMO_TICKET_PUBLIC_KEY:'x'}])expect(()=>validateDemoConfig({...e,...bad} as never)).toThrow();
});
