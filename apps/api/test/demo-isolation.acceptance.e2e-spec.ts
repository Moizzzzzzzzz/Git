import { generateKeyPairSync,randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfig } from '../src/config/app-config';
import { loadEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { DemoSessionStore } from '../src/demo/demo-session.store';
import { createTicket,DEMO_ENVIRONMENT,DEMO_RESET_VERSION } from '../src/demo/demo-ticket';
import { configureApp } from '../src/bootstrap';
import { JwtService } from '@nestjs/jwt';
import { DemoSafetyService } from '../src/demo/demo-safety.service';
import { WechatGateway } from '../src/wechat/wechat.gateway';
import { DeliveryService } from '../src/notifications/delivery.service';

/** QA isolated HTTP, actual restricted PG and Redis through local proxy; never production. */
describe('演示隔离真实HTTP与受限资源验收',()=>{
 let app:INestApplication; let prisma:PrismaClient; let redis:Redis;
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const mk=(personaId='p01',chainId='a'.repeat(64))=>createTicket(keys.privateKey,{environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:personaId as 'p01',chainId,jti:randomBytes(16).toString('hex')});
 const req=()=>request(app.getHttpServer());
 beforeAll(async()=>{
  if(!process.env.QA_RUNTIME_URL?.includes('127.0.0.1')||!process.env.QA_REDIS_URL?.includes('127.0.0.1'))throw Error('拒绝非QA本机资源');
  process.env.DEMO_RUNTIME_MODE='demo';
  const env=loadEnv({NODE_ENV:'test',PUBLIC_BASE_URL:'http://127.0.0.1:3000',QR_BASE_URL:'http://127.0.0.1:3000',DATABASE_URL:'postgresql://REDACTED:REDACTED@demo-db:5432/fabricqc_demo',REDIS_URL:'redis://REDACTED:REDACTED@demo-redis:6379',RUN_WORKERS:'false',JWT_ACCESS_SECRET:'PUBLIC_REDACTED',BIND_CODE_PEPPER:'isolated-pepper-123456',DEMO_RUNTIME_MODE:'demo',DEMO_TICKET_PUBLIC_KEY:keys.publicKey,DEMO_SESSION_SECRET:'PUBLIC_REDACTED',STORAGE_PROVIDER:'minio',STORAGE_ENDPOINT:'http://demo-minio:9000',STORAGE_PUBLIC_ENDPOINT:'https://192.0.2.1',STORAGE_BUCKET:'demo-media',STORAGE_ACCESS_KEY_ID:'qa-demo-app',STORAGE_SECRET_ACCESS_KEY:'PUBLIC_REDACTED',STORAGE_FORCE_PATH_STYLE:'true'});
  prisma=new PrismaClient({datasourceUrl:process.env.QA_RUNTIME_URL});redis=new Redis(process.env.QA_REDIS_URL!,{maxRetriesPerRequest:1});
  const module=await Test.createTestingModule({imports:[AppModule.register({runWorkers:false,disableRateLimit:true})]}).overrideProvider(AppConfig).useValue(new AppConfig(env)).overrideProvider(PrismaService).useValue(prisma).overrideProvider(DemoSessionStore).useValue(new DemoSessionStore(redis)).compile();
  app=module.createNestApplication({logger:['error']});configureApp(app);await app.init();
 },60000);
 afterAll(async()=>{if(app)await app.close();if(prisma)await prisma.$disconnect();if(redis)redis.disconnect();delete process.env.DEMO_RUNTIME_MODE;});
 it('实际受限账号通过启动marker检查，拒绝伪票据和微信登录',async()=>{
  const identity=await prisma.$queryRaw<{current_user:string;current_database:string}[]>`SELECT current_user,current_database()`;expect(identity[0]).toEqual({current_user:'fqc_demo_app',current_database:'fabricqc_demo'});
  const bad=await req().post('/api/demo/exchange').send({ticket:'not.valid.signature'});expect(bad.status).toBe(401);expect(bad.body.accessToken).toBeUndefined();
  const expiredTicket=createTicket(keys.privateKey,{environmentId:DEMO_ENVIRONMENT,resetVersion:DEMO_RESET_VERSION,personaId:'p01',chainId:'d'.repeat(64),jti:randomBytes(16).toString('hex')},Math.floor(Date.now()/1000)-61);
  expect((await req().post('/api/demo/exchange').send({ticket:expiredTicket})).status).toBe(401);
  expect((await req().post('/api/demo/exchange').set('Authorization','Bearer unrelated').send({ticket:mk()})).status).toBe(400);
  expect((await req().post('/api/auth/wechat/login').send({code:'fake'})).status).toBe(403);
  expect((await req().post('/api/auth/admin/login').send({username:'fake',password:'fake'})).status).toBe(403);
  expect((await req().post('/api/auth/refresh').send({refreshToken:'fake'})).status).toBe(403);
 });
 it('真实Express大小写和尾斜杠不能绕过演示环境禁用登录及刷新',async()=>{
  for(const path of ['/API/AUTH/WECHAT/LOGIN','/api/Auth/WeChat/Login/','/API/AUTH/ADMIN/LOGIN','/api/AUTH/REFRESH/','/API/AUTH/WECHAT/BIND/']){
   const result=await req().post(path).send({code:'fake',username:'fake',password:'fake',refreshToken:'fake'});
   expect(result.status).toBe(403);
  }
 });
 it('真实PG禁止修改marker和迁移；新增角色成员链后启动安全检查拒绝',async()=>{
  expect(process.env.QA_PROVISION_URL).toContain('127.0.0.1');
  await expect(prisma.$executeRaw`UPDATE fqc_demo_guard.environment_marker SET reset_version='tampered'`).rejects.toThrow();
  await expect(prisma.$executeRaw`DELETE FROM public._prisma_migrations`).rejects.toThrow();
  await expect(redis.set('fqc:demo:guard:identity','tampered')).rejects.toThrow();
  await expect(redis.set('qa-outside-namespace','denied')).rejects.toThrow();
  await expect(redis.eval("return redis.call('SET',ARGV[1],'denied')",0,'qa-outside-namespace')).rejects.toThrow();
  await expect(redis.flushdb()).rejects.toThrow();
  const provision=new PrismaClient({datasourceUrl:process.env.QA_PROVISION_URL});
  try {
   await provision.$executeRawUnsafe('CREATE ROLE fqc_demo_qa_extra NOLOGIN');
   await provision.$executeRawUnsafe('GRANT fqc_demo_qa_extra TO fqc_demo_app');
   await expect(app.get(DemoSafetyService).onModuleInit()).rejects.toThrow('演示环境隔离核验失败');
  } finally {
   await provision.$executeRawUnsafe('REVOKE fqc_demo_qa_extra FROM fqc_demo_app');
   await provision.$executeRawUnsafe('DROP ROLE IF EXISTS fqc_demo_qa_extra');
   await provision.$disconnect();
  }
  await expect(app.get(DemoSafetyService).onModuleInit()).resolves.toBeUndefined();
 });
 it('候选pending不能读业务，commit后可以读；相同ticket不能复用',async()=>{
  const ticket=mk();const exchange=await req().post('/api/demo/exchange').send({ticket});expect(exchange.status).toBe(200);expect(exchange.body.sessionState).toBe('PENDING');const token=exchange.body.accessToken;
  expect((await req().post('/api/demo/exchange').send({ticket})).status).toBe(409);
  expect((await req().get('/api/tasks/mine').set('Authorization',`Bearer ${token}`)).status).toBe(403);
  const pending=await req().get('/api/demo/me').set('Authorization',`Bearer ${token}`);expect(pending.status).toBe(200);expect(pending.body).toMatchObject({personaId:'p01',sessionState:'PENDING'});
  const commit=await req().post('/api/demo/commit').set('Authorization',`Bearer ${token}`).send({});expect(commit.status).toBe(200);expect(commit.body.sessionState).toBe('ACTIVE');
  expect((await req().post('/api/demo/commit').set('Authorization',`Bearer ${token}`).send({})).status).toBe(200);
  expect((await req().get('/api/tasks/business').set('Authorization',`Bearer ${token}`)).status).toBe(200);
 });
 it('并发候选只有一个可激活，旧链不影响另一链',async()=>{
  const chain='b'.repeat(64),other='c'.repeat(64);
  const one=await req().post('/api/demo/exchange').send({ticket:mk('p01',chain)}),two=await req().post('/api/demo/exchange').send({ticket:mk('p02',chain)}),third=await req().post('/api/demo/exchange').send({ticket:mk('p03',other)});
  expect([one.status,two.status,third.status]).toEqual([200,200,200]);
  expect((await req().post('/api/demo/commit').set('Authorization',`Bearer ${third.body.accessToken}`).send({})).status).toBe(200);
  const commits=await Promise.all([one,two].map(x=>req().post('/api/demo/commit').set('Authorization',`Bearer ${x.body.accessToken}`).send({})));
  expect(commits.map(x=>x.status).sort()).toEqual([200,409]);expect((await req().get('/api/demo/me').set('Authorization',`Bearer ${third.body.accessToken}`)).body.sessionState).toBe('ACTIVE');
 });
 it('七个固定角色从真实演示用户及角色范围读取，不接受生产token或票据作为会话',async()=>{
  const roles=['SALES','BUSINESS_MANAGER','BUSINESS_CLERK','QC_SUPERVISOR','INSPECTOR','QUALITY_MANAGER','ADMIN'];
  for(const [i,role] of roles.entries()){
   const issued=await req().post('/api/demo/exchange').send({ticket:mk(`p0${i+1}`,randomBytes(32).toString('hex'))});expect(issued.status).toBe(200);
   const token=issued.body.accessToken;expect((await req().post('/api/demo/commit').set('Authorization',`Bearer ${token}`).send({})).status).toBe(200);
   const me=await req().get('/api/auth/me').set('Authorization',`Bearer ${token}`);expect(me.status).toBe(200);expect(me.body.roles.map((r:{role:string})=>r.role)).toEqual([role]);
  }
  const prod=new JwtService().sign({sub:'real-user',sid:'real-session'},{secret:'PUBLIC_REDACTED',algorithm:'HS256',issuer:'fabricqc',expiresIn:900});
  expect((await req().get('/api/auth/me').set('Authorization',`Bearer ${prod}`)).status).toBe(401);
  expect((await req().get('/api/auth/me').set('Authorization',`Bearer ${mk()}`)).status).toBe(401);
 });
 it('过期和撤销码由业务执行前守卫发出且不写入任务',async()=>{
  const issued=await req().post('/api/demo/exchange').send({ticket:mk('p01',randomBytes(32).toString('hex'))});expect(issued.status).toBe(200);const token=issued.body.accessToken;
  expect((await req().post('/api/demo/commit').set('Authorization',`Bearer ${token}`).send({})).status).toBe(200);
  expect((await req().post('/api/demo/logout').set('Authorization',`Bearer ${token}`).send({})).status).toBe(200);
  const before=await prisma.qcTask.count();
  const revoked=await req().post('/api/tasks/business').set('Authorization',`Bearer ${token}`).send({title:'QA-不得写入'});
  expect(revoked.status).toBe(401);expect(revoked.body.code).toBe('DEMO_LEASE_REVOKED');
  const expired=new JwtService().sign({sub:'13943a7e-f52a-4824-984c-1771fefbd6a4',sid:'a'.repeat(48),chainId:'b'.repeat(64),typ:'fqc_demo_access',personaId:'p01',resetVersion:'v1'},{secret:'PUBLIC_REDACTED',algorithm:'HS256',issuer:'fabricqc-demo',audience:'fabricqc-demo-api',expiresIn:-1});
  const stale=await req().post('/api/tasks/business').set('Authorization',`Bearer ${expired}`).send({title:'QA-不得写入'});
  expect(stale.status).toBe(401);expect(stale.body.code).toBe('DEMO_LEASE_EXPIRED');expect(await prisma.qcTask.count()).toBe(before);
 });
 it('演示应用层阻止微信投递并保持外发调用为零',async()=>{
  const network=jest.spyOn(global,'fetch');
  try {
   await expect(app.get(WechatGateway).sendSubscribeMessage({openId:'qa-not-real',templateId:'qa-not-real',page:'pages/index/index',data:{}})).rejects.toThrow();
   await expect(app.get(DeliveryService).deliver('qa-not-real')).rejects.toThrow('演示环境禁止外发');
   expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
 });
 it('Nest关闭释放真实Redis连接且不清除已激活会话',async()=>{
  const issued=await req().post('/api/demo/exchange').send({ticket:mk('p01',randomBytes(32).toString('hex'))});expect(issued.status).toBe(200);
  const token=issued.body.accessToken as string;expect((await req().post('/api/demo/commit').set('Authorization',`Bearer ${token}`).send({})).status).toBe(200);
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()) as {sid:string};
  const probe=new Redis(process.env.QA_REDIS_URL!,{maxRetriesPerRequest:1});
  try {
   expect((await probe.hgetall(`fqc:demo:v1:session:${claims.sid}`)).state).toBe('ACTIVE');
   const ended=redis.status==='end'?Promise.resolve():new Promise<void>(resolve=>redis.once('end',()=>resolve()));
   await app.close();await ended;expect(redis.status).toBe('end');
   expect((await probe.hgetall(`fqc:demo:v1:session:${claims.sid}`)).state).toBe('ACTIVE');
   expect(await probe.get('fqc:demo:guard:identity')).toBe('fabricqc-demo|v1');
  } finally {probe.disconnect();}
 });
 it.todo('真实对象最小权限及网络外发阻断，需独立部署环境');
});

describe('模拟正式端真实HTTP回归',()=>{
 let app:INestApplication, prisma:PrismaClient; let ownerId:string, ownerToken:string;
 const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 async function makeApp(enabled:boolean){
  delete process.env.DEMO_RUNTIME_MODE;
  const values:Record<string,string>={NODE_ENV:'test',PUBLIC_BASE_URL:'http://127.0.0.1:3000',QR_BASE_URL:'http://127.0.0.1:3000',DATABASE_URL:process.env.QA_REAL_URL!,REDIS_URL:'redis://127.0.0.1:1',RUN_WORKERS:'false',JWT_ACCESS_SECRET:'PUBLIC_REDACTED',BIND_CODE_PEPPER:'isolated-pepper-123456'};
  if(enabled)Object.assign(values,{DEMO_ENTRY_ENABLED:'true',DEMO_ALLOWED_USER_ID:ownerId,DEMO_CHAIN_SECRET:'PUBLIC_REDACTED',DEMO_TICKET_PRIVATE_KEY:keys.privateKey});
  const module=await Test.createTestingModule({imports:[AppModule.register({runWorkers:false,disableRateLimit:true})]}).overrideProvider(AppConfig).useValue(new AppConfig(loadEnv(values))).overrideProvider(PrismaService).useValue(prisma).compile();
  const candidate=module.createNestApplication({logger:['error']});configureApp(candidate);await candidate.init();return candidate;
 }
 beforeAll(async()=>{
  expect(process.env.QA_REAL_URL).toContain('127.0.0.1');prisma=new PrismaClient({datasourceUrl:process.env.QA_REAL_URL});
  const owner=await prisma.user.findUniqueOrThrow({where:{username:'admin'}});ownerId=owner.id;app=await makeApp(false);
 },60000);
 afterAll(async()=>{if(app)await app.close();if(prisma)await prisma.$disconnect();});
 it('正式默认关闭无需演示密钥且正常登录，默认演示能力被拒',async()=>{
  const login=await request(app.getHttpServer()).post('/api/auth/admin/login').send({username:'admin',password:'PUBLIC_REDACTED'});expect(login.status).toBe(200);ownerToken=login.body.accessToken;
  expect((await request(app.getHttpServer()).get('/api/auth/me').set('Authorization',`Bearer ${ownerToken}`)).status).toBe(200);
  expect((await request(app.getHttpServer()).get('/api/demo/capability').set('Authorization',`Bearer ${ownerToken}`)).status).toBe(403);
 });
 it('开启后仅白名单可签票，严禁注入角色，并拒绝演示凭据作为正式会话',async()=>{
  await app.close();app=await makeApp(true);
  const call=()=>request(app.getHttpServer());
  const login=await call().post('/api/auth/admin/login').send({username:'admin',password:'PUBLIC_REDACTED'});expect(login.status).toBe(200);ownerToken=login.body.accessToken;
  expect((await call().get('/api/demo/capability').set('Authorization',`Bearer ${ownerToken}`)).body.personas).toHaveLength(7);
  expect((await call().post('/api/demo/ticket').set('Authorization',`Bearer ${ownerToken}`).send({personaId:'p01',role:'ADMIN'})).status).toBe(400);
  const issued=await call().post('/api/demo/ticket').set('Authorization',`Bearer ${ownerToken}`).send({personaId:'p01'});expect(issued.status).toBe(200);
  expect((await call().get('/api/auth/me').set('Authorization',`Bearer ${issued.body.ticket}`)).status).toBe(401);
  const demo=new JwtService().sign({sub:'demo',sid:'demo',typ:'fqc_demo_access'},{secret:'PUBLIC_REDACTED',algorithm:'HS256',issuer:'fabricqc-demo',audience:'fabricqc-demo-api',expiresIn:300});
  expect((await call().get('/api/auth/me').set('Authorization',`Bearer ${demo}`)).status).toBe(401);
  const name=`qa-other-${randomBytes(4).toString('hex')}`;
  const newUser=await call().post('/api/users').set('Authorization',`Bearer ${ownerToken}`).send({employeeNo:name,name:'QA-NONOWNER',username:name,password:'PUBLIC_REDACTED',roles:[{role:'INSPECTOR'}]});expect(newUser.status).toBe(201);
  const other=await call().post('/api/auth/admin/login').send({username:name,password:'PUBLIC_REDACTED'});expect(other.status).toBe(200);
  expect((await call().post('/api/demo/ticket').set('Authorization',`Bearer ${other.body.accessToken}`).send({personaId:'p01'})).status).toBe(403);
 });
});
