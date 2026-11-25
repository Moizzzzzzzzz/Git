import { loadEnv } from '../config/env';
describe('演示启动前配置验证',()=>{
 it('demo指向非演示数据库时在构造数据库连接前拒绝',()=>{
  const env={NODE_ENV:'test',PUBLIC_BASE_URL:'https://192.0.2.1',QR_BASE_URL:'https://192.0.2.1',DATABASE_URL:'postgresql://REDACTED:REDACTED@production-db:5432/fabricqc_demo',REDIS_URL:'redis://REDACTED:REDACTED@demo-redis:6379',JWT_ACCESS_SECRET:'a'.repeat(32),BIND_CODE_PEPPER:'b'.repeat(16),DEMO_RUNTIME_MODE:'demo',RUN_WORKERS:'false',DEMO_TICKET_PUBLIC_KEY:'bad',DEMO_SESSION_SECRET:'c'.repeat(32),STORAGE_PROVIDER:'minio',STORAGE_ENDPOINT:'http://demo-minio:9000',STORAGE_PUBLIC_ENDPOINT:'https://192.0.2.1',STORAGE_BUCKET:'demo-media',STORAGE_ACCESS_KEY_ID:'demo-app',STORAGE_SECRET_ACCESS_KEY:'pass',STORAGE_FORCE_PATH_STYLE:'true'};
  expect(()=>loadEnv(env)).toThrow('演示环境隔离配置不符合要求');
 });
});
