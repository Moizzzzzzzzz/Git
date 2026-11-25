import { generateKeyPairSync } from 'node:crypto';
import { validateDemoConfig } from './demo-safety';
describe('演示环境启动保护',()=>{
 const publicKey=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}).publicKey;
 const config={DEMO_RUNTIME_MODE:'demo',DEMO_ENTRY_ENABLED:false,RUN_WORKERS:false,DEMO_TICKET_PUBLIC_KEY:publicKey,DEMO_SESSION_SECRET:'x'.repeat(32),JWT_ACCESS_SECRET:'y'.repeat(32),DATABASE_URL:'postgresql://REDACTED:REDACTED@demo-db:5432/fabricqc_demo',REDIS_URL:'redis://REDACTED:REDACTED@demo-redis:6379',STORAGE_PROVIDER:'minio',STORAGE_ENDPOINT:'http://demo-minio:9000',STORAGE_PUBLIC_ENDPOINT:'https://192.0.2.1',STORAGE_BUCKET:'demo-media',STORAGE_ACCESS_KEY_ID:'demo-app',STORAGE_SECRET_ACCESS_KEY:'PUBLIC_REDACTED',STORAGE_FORCE_PATH_STYLE:true};
 it('生产默认不开启demo不要求任何演示密钥',()=>expect(()=>validateDemoConfig({DEMO_RUNTIME_MODE:'production'} as never)).not.toThrow());
 it('生产显式开启时缺少签票密钥则拒绝启动',()=>{
  expect(()=>validateDemoConfig({DEMO_RUNTIME_MODE:'production',DEMO_ENTRY_ENABLED:true} as never)).toThrow();
 });
 it('隔离demo配置接受，误连生产和携带微信凭据拒绝',()=>{
  expect(()=>validateDemoConfig(config as never)).not.toThrow();
  expect(()=>validateDemoConfig({...config,DATABASE_URL:'postgresql://REDACTED:REDACTED@prod:5432/main'} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,WECHAT_APP_SECRET:'danger'} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,RUN_WORKERS:true} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,DEMO_TICKET_PUBLIC_KEY:'invalid'} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,REDIS_URL:'redis://demo-redis:6379'} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,STORAGE_ACCESS_KEY_ID:undefined} as never)).toThrow();
  expect(()=>validateDemoConfig({...config,STORAGE_BUCKET:'production'} as never)).toThrow();
 });
});
